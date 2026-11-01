//! Preserve target identity and reconcile selections in the same transaction.
use rusqlite::{Connection, params};
use std::collections::{HashMap, HashSet};

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
