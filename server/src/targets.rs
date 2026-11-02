//! Preserve target identity and reconcile selections in the same transaction.
use rusqlite::{Connection, params};
use std::collections::{HashMap, HashSet};

/// Change switches together; target identities, node selections and history stay intact.
pub fn set_enabled(conn: &mut Connection, ids: &[i64], enabled: bool, exclusive: bool, ip: &str) -> rusqlite::Result<usize> {
    let selected: HashSet<i64> = ids.iter().copied().collect();
    let tx = conn.transaction()?;
    let existing: Vec<(i64, bool)> = tx.prepare("SELECT id,enabled FROM monitor_targets")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    if selected.is_empty() || selected.iter().any(|id| !existing.iter().any(|(current, _)| current == id)) {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    let mut changed = 0;
    {
        let mut update = tx.prepare("UPDATE monitor_targets SET enabled=?2 WHERE id=?1")?;
        for (id, was_enabled) in existing {
            let next = if selected.contains(&id) { enabled } else if exclusive { false } else { continue };
            if next != was_enabled { changed += update.execute(params![id, next])?; }
        }
    }
    let mode = if exclusive { "仅启用所选" } else if enabled { "启用所选" } else { "关闭所选" };
    tx.execute("INSERT INTO audit_logs(action,ip) VALUES(?1,?2)",
        params![format!("批量设置监控目标：{mode} {} 项，变更 {changed} 项", selected.len()), ip])?;
    tx.commit()?;
    Ok(changed)
}

pub fn reconcile(conn: &Connection, aliases: &HashMap<i64,i64>) -> rusqlite::Result<usize> {
    let valid: HashSet<i64> = conn.prepare("SELECT id FROM monitor_targets")?.query_map([],|r|r.get(0))?.collect::<rusqlite::Result<_>>()?;
    let nodes: Vec<(String,String)> = conn.prepare("SELECT id,monitor_targets FROM servers WHERE monitor_mode='selected'")?
        .query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut paused=0;
    for (id, selected) in nodes {
        let mut ids:Vec<i64>=selected.split(',').filter_map(|s|s.trim().parse().ok()).map(|id|*aliases.get(&id).unwrap_or(&id)).filter(|id|valid.contains(id)).collect();
        ids.sort_unstable();ids.dedup();
        let selection=ids.iter().map(ToString::to_string).collect::<Vec<_>>().join(",");
        if ids.is_empty() {
            paused+=conn.execute("UPDATE servers SET monitor_targets='',monitor_enabled=0 WHERE id=?1 AND monitor_enabled!=0",[&id])?;
        } else { conn.execute("UPDATE servers SET monitor_targets=?2 WHERE id=?1",params![id,selection])?; }
    }
    Ok(paused)
}

pub fn reset(conn: &mut Connection) -> rusqlite::Result<usize> {
    let tx=conn.transaction()?;
    let existing:Vec<(i64,String,i64)>=tx.prepare("SELECT id,host,port FROM monitor_targets ORDER BY id")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut keep=HashSet::new();let mut aliases=HashMap::new();
    for (name,host,port,carrier,region) in crate::db::default_monitor_targets() {
        let matches:Vec<i64>=existing.iter().filter(|(_,h,p)|h.eq_ignore_ascii_case(&host)&&*p==port).map(|(id,_,_)|*id).collect();
        let id=if let Some(id)=matches.first() {
            tx.execute("UPDATE monitor_targets SET name=?2,host=?3,port=?4,carrier=?5,region=?6,enabled=1 WHERE id=?1",params![id,name,host,port,carrier,region])?; *id
        } else {
            tx.execute("INSERT INTO monitor_targets(name,host,port,carrier,region,enabled) VALUES(?1,?2,?3,?4,?5,1)",params![name,host,port,carrier,region])?; tx.last_insert_rowid()
        };
        keep.insert(id);for old in matches { aliases.insert(old,id); }
    }
    for (id,_,_) in existing { if !keep.contains(&id) {tx.execute("DELETE FROM monitor_targets WHERE id=?1",[id])?;} }
    let paused=reconcile(&tx,&aliases)?;tx.commit()?;Ok(paused)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn batch_switches_are_atomic_and_preserve_node_selections() {
        let db = crate::db::init_db(":memory:").unwrap();
        let mut c = db.lock().unwrap();
        let selected: Vec<i64> = c.prepare("SELECT id FROM monitor_targets WHERE region IN ('北京','上海','广东')")
            .unwrap().query_map([], |row| row.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(selected.len(), 9);
        let selection = selected[0].to_string();
        c.execute("INSERT INTO servers(id,token,name,region,region_name,provider,monitor_enabled,monitor_mode,monitor_targets) VALUES('test','token','test','','','',1,'selected',?1)", [&selection]).unwrap();
        assert_eq!(set_enabled(&mut c, &selected, true, true, "test").unwrap(), 84);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM monitor_targets WHERE enabled=1", [], |row| row.get::<_,i64>(0)).unwrap(), 9);
        assert_eq!(c.query_row("SELECT monitor_targets FROM servers WHERE id='test'", [], |row| row.get::<_,String>(0)).unwrap(), selection);
        assert_eq!(set_enabled(&mut c, &selected[..3], false, false, "test").unwrap(), 3);
        assert_eq!(set_enabled(&mut c, &[selected[0], selected[0]], true, false, "test").unwrap(), 1);
        assert!(set_enabled(&mut c, &[selected[0], i64::MAX], false, false, "test").is_err());
        assert_eq!(c.query_row("SELECT enabled FROM monitor_targets WHERE id=?1", [selected[0]], |row| row.get::<_,bool>(0)).unwrap(), true);
        c.execute_batch("CREATE TRIGGER fail_target_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        assert!(set_enabled(&mut c, &[selected[0]], false, false, "test").is_err());
        assert_eq!(c.query_row("SELECT enabled FROM monitor_targets WHERE id=?1", [selected[0]], |row| row.get::<_,bool>(0)).unwrap(), true);
    }
    #[test]
    fn repeated_resets_preserve_identity_and_selected_nodes() {
        let db=crate::db::init_db(":memory:").unwrap();let mut c=db.lock().unwrap();
        let id:i64=c.query_row("SELECT id FROM monitor_targets ORDER BY id LIMIT 1",[],|r|r.get(0)).unwrap();
        c.execute("INSERT INTO servers(id,token,name,region,region_name,provider,monitor_enabled,monitor_mode,monitor_targets) VALUES('test','token','test','','','',1,'selected',?1)",[id.to_string()]).unwrap();
        assert_eq!(reset(&mut c).unwrap(),0);assert_eq!(reset(&mut c).unwrap(),0);
        let (enabled,selection):(i64,String)=c.query_row("SELECT monitor_enabled,monitor_targets FROM servers WHERE id='test'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(enabled,1);assert_eq!(selection,id.to_string());
        c.execute("DELETE FROM monitor_targets WHERE id=?1",[id]).unwrap();assert_eq!(reconcile(&c,&HashMap::new()).unwrap(),1);
    }
}
