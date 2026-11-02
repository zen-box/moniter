import React, { useEffect, useMemo, useState, useId } from "react";
import { Alert, Button, Card, CardBody, Chip, Code, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Pagination, Select, SelectItem, Switch, useDisclosure } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { API, requestError, type Target as MonitorTarget } from "../lib";
import { useLanguage } from "../runtime";
import { useAdminResource } from "../useAdminResource";
import { useConfirm } from "./ConfirmProvider";

const regionNames: Record<string, string> = {
  "河北":"Hebei", "山西":"Shanxi", "辽宁":"Liaoning", "吉林":"Jilin", "黑龙江":"Heilongjiang",
  "江苏":"Jiangsu", "浙江":"Zhejiang", "安徽":"Anhui", "福建":"Fujian", "江西":"Jiangxi",
  "山东":"Shandong", "河南":"Henan", "湖北":"Hubei", "湖南":"Hunan", "广东":"Guangdong",
  "海南":"Hainan", "四川":"Sichuan", "贵州":"Guizhou", "云南":"Yunnan", "陕西":"Shaanxi",
  "甘肃":"Gansu", "青海":"Qinghai", "内蒙古":"Inner Mongolia", "广西":"Guangxi", "西藏":"Tibet",
  "宁夏":"Ningxia", "新疆":"Xinjiang", "北京":"Beijing", "天津":"Tianjin", "上海":"Shanghai", "重庆":"Chongqing",
};
type TargetGroup = { region: string; targets: MonitorTarget[]; matches: MonitorTarget[] };

export function TargetsPage({ onReload }: { onReload: () => void }) {
  const { language, t } = useLanguage();
  const tr = (zh: string, en: string) => language === "zh" ? zh : en;
  const regionLabel = (region: string) => !region ? tr("未分组", "Ungrouped") : language === "en" ? regionNames[region] || region : region;
  const carrierLabel = (carrier: string) => ({ct: tr("电信", "China Telecom"), cu: tr("联通", "China Unicom"), cm: tr("移动", "China Mobile"), intl: tr("国际", "International")} as Record<string,string>)[carrier] || carrier || "—";
  const confirmAction = useConfirm();
  const { data: targets, setData: setTargets, error: loadError, loading, reload: load } = useAdminResource<MonitorTarget[]>("/api/v1/admin/targets", []);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [regionPickerOpen, setRegionPickerOpen] = useState(false);
  const [current, setCurrent] = useState<MonitorTarget | null>(null);
  const edit = useDisclosure();
  const reduceMotion = useReducedMotion();
  const groupId = useId();
  const groups = useMemo(() => {
    const entries = new Map<string, MonitorTarget[]>();
    for (const target of targets) {
      const key = target.region.trim();
      if (!entries.has(key)) entries.set(key, []);
      entries.get(key)!.push(target);
    }
    return [...entries].map(([region, targets]) => ({region, targets})).sort((a,b) =>
      regionLabel(a.region).localeCompare(regionLabel(b.region), language === "zh" ? "zh-CN" : "en"));
  }, [targets, language]);
  const filtered: TargetGroup[] = groups.map(group => ({...group, matches: group.targets.filter(target =>
    `${target.name} ${target.host} ${target.region} ${regionLabel(group.region)} ${carrierLabel(target.carrier)}`.toLowerCase().includes(query.trim().toLowerCase()))})).filter(group => group.matches.length);
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  useEffect(() => setPage(value => Math.min(value, pages)), [pages]);
  const selectedTargets = targets.filter(target => selectedRegions.has(target.region.trim()));
  const metroTargets = targets.filter(target => ["北京", "上海", "广东", "广州"].includes(target.region.trim().replace(/[省市]$/, "")));
  const enabled = targets.filter(target => target.enabled).length;
  const unavailable = busy || loading || !!loadError;
  const change = async (ids: number[], value: boolean, exclusive = false) => {
    if (unavailable || !ids.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await API("/api/v1/admin/targets/batch", {method: "POST", body: JSON.stringify({ids, enabled: value, exclusive})});
      if (!result.success) throw new Error(result.message || tr("批量设置失败，请稍后重试", "Could not update the targets. Please try again."));
      const selected = new Set(ids);
      setTargets(previous => previous.map(target => selected.has(target.id) ? {...target, enabled: value} : exclusive ? {...target, enabled: false} : target));
      onReload();
    } catch (error) { setError(requestError(error)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    if (unavailable || !await confirmAction({title: t("targets.reset", "重置默认目标"), body: t("targets.confirmReset", "确定恢复系统默认的延迟监控目标？当前自定义目标将被替换。"), danger: true})) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await API("/api/v1/admin/targets/reset_defaults", {method: "POST"});
      if (!result.success) throw new Error(result.message || tr("重置失败", "Reset failed"));
      setNotice(tr(`已恢复默认目标；${result.paused_nodes || 0} 个没有剩余指定目标的节点已暂停探测。`, `Defaults restored. ${result.paused_nodes || 0} nodes with no selected targets were paused.`));
      await load(); onReload();
    } catch (error) { setError(requestError(error)); }
    finally { setBusy(false); }
  };
  const remove = async (target: MonitorTarget) => {
    if (unavailable || !await confirmAction({title: tr("删除目标", "Delete target"), body: tr(`删除「${target.name}」？仅选择此目标的节点将暂停探测。`, `Delete "${target.name}"? Nodes with no remaining selected targets will be paused.`), danger:true})) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await API("/api/v1/admin/targets/delete", {method:"POST", body:JSON.stringify({id:target.id})});
      if (!result.success) throw new Error(result.message || tr("删除失败", "Delete failed"));
      if (result.paused_nodes) setNotice(tr(`${result.paused_nodes} 个没有剩余指定目标的节点已暂停探测`, `${result.paused_nodes} nodes with no remaining targets were paused`));
      await load(); onReload();
    } catch (error) { setError(requestError(error)); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-stack target-settings-page">
      <div className="page-toolbar">
        <div><h2>{t("page.targets", "延迟监控目标")}</h2><p>{tr("按地区管理探测目标，展开后可单独调整运营商。", "Manage targets by region, or expand a region to adjust individual carriers.")}</p></div>
        <div className="toolbar-actions">
          <Button variant="flat" onPress={reset} isDisabled={unavailable}>{t("targets.reset", "重置默认目标")}</Button>
          <Button color="primary" startContent={<Plus size={16}/>} isDisabled={busy} onPress={() => {setCurrent(null); edit.onOpen();}}>{t("targets.add", "添加目标")}</Button>
        </div>
      </div>
      {loadError && <Alert color="danger" title={loadError} endContent={<Button size="sm" variant="flat" onPress={() => void load()}>{tr("重试", "Retry")}</Button>}/>}
      {error && <Alert color="danger" title={error}/>}
      {notice && <Alert color="success" title={notice}/>}
      <Card className="panel-card target-shortcuts">
        <CardBody className="target-shortcuts-body">
          <div className="target-shortcuts-heading"><div><h3>{tr("快捷设置", "Quick setup")}</h3><p>{tr("北上广对应北京、上海、广东；“仅启用”会关闭其他地区的目标。", "The preset covers Beijing, Shanghai and Guangdong. “Enable only” turns off other targets.")}</p></div><Chip size="sm" variant="flat" role="status" aria-live="polite">{tr(`已启用 ${enabled} / ${targets.length}`, `${enabled} / ${targets.length} enabled`)}</Chip></div>
          <div className="target-shortcut-actions">
            <Button color="primary" variant="flat" isDisabled={unavailable || !metroTargets.length} onPress={() => void change(metroTargets.map(target => target.id), true, true)}>{tr("仅启用北上广", "Enable only Beijing / Shanghai / Guangdong")}</Button>
            <Button variant="flat" isDisabled={unavailable || !targets.length || enabled === targets.length} onPress={() => void change(targets.map(target => target.id), true)}>{tr("全部启用", "Enable all")}</Button>
            <Button variant="flat" isDisabled={unavailable || !enabled} onPress={() => void change(targets.map(target => target.id), false)}>{tr("全部关闭", "Disable all")}</Button>
          </div>
          <div className="target-region-selection" onKeyDownCapture={event => {
            // Portal events bubble through React; preserve selection when dismissing.
            if (regionPickerOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRegionPickerOpen(false); }
          }}>
            <Select label={tr("批量选择地区", "Select regions for bulk changes")} placeholder={tr("选择需要的地区（可多选）", "Choose regions (multiple)")} selectionMode="multiple"
              isOpen={regionPickerOpen} onOpenChange={setRegionPickerOpen}
              selectedKeys={new Set(groups.filter(group => selectedRegions.has(group.region)).map(group => `region:${group.region}`))} isDisabled={unavailable}
              onSelectionChange={keys => setSelectedRegions(new Set(keys === "all" ? groups.map(group => group.region) : [...keys].map(key => String(key).slice(7))))}>
              {groups.map(group => <SelectItem key={`region:${group.region}`} textValue={regionLabel(group.region)}>{regionLabel(group.region)} · {group.targets.length}</SelectItem>)}
            </Select>
            <div className="target-shortcut-actions">
              <Button color="primary" isDisabled={unavailable || !selectedTargets.length} onPress={() => void change(selectedTargets.map(target => target.id), true, true)}>{tr("仅启用所选地区", "Enable only selected")}</Button>
              <Button variant="flat" isDisabled={unavailable || !selectedTargets.length} onPress={() => void change(selectedTargets.map(target => target.id), true)}>{tr("启用所选", "Enable selected")}</Button>
              <Button variant="flat" isDisabled={unavailable || !selectedTargets.length} onPress={() => void change(selectedTargets.map(target => target.id), false)}>{tr("关闭所选", "Disable selected")}</Button>
            </div>
          </div>
        </CardBody>
      </Card>
      <Card className="panel-card target-groups-card">
        <CardBody className="p-0">
          <div className="table-toolbar target-groups-toolbar">
            <Input aria-label={tr("搜索监控目标", "Search targets")} placeholder={tr("搜索名称、地址或地区", "Search name, host or region")} value={query} startContent={<Search size={15}/>}
              onValueChange={value => {setQuery(value); setPage(1); if (value.trim()) setExpanded(new Set(groups.map(group => group.region)));}}/>
            <div className="target-fold-actions"><Button size="sm" variant="light" onPress={() => setExpanded(new Set(groups.map(group => group.region)))}>{tr("全部展开", "Expand all")}</Button><Button size="sm" variant="light" onPress={() => setExpanded(new Set())}>{tr("全部收起", "Collapse all")}</Button></div>
          </div>
          {filtered.slice((page - 1) * 10, page * 10).map((group, index) => {
            const onCount = group.targets.filter(target => target.enabled).length;
            const open = expanded.has(group.region);
            const id = `${groupId}-${page}-${index}`;
            return <section className="target-region-group" key={group.region} aria-label={regionLabel(group.region)}>
              <div className="target-region-heading">
                <Button className="target-region-trigger" variant="light" aria-expanded={open} aria-controls={id} onPress={() => setExpanded(previous => {const next = new Set(previous); if (next.has(group.region)) next.delete(group.region); else next.add(group.region); return next;})}>
                  <ChevronRight className={open ? "is-open" : ""} size={17}/><MapPin size={17}/><span>{regionLabel(group.region)}</span><span className="target-region-count">{group.targets.length}</span>
                </Button>
                <div className="target-region-state"><span className={onCount && onCount !== group.targets.length ? "is-partial" : ""}>{tr(`已启用 ${onCount} / ${group.targets.length}`, `${onCount} / ${group.targets.length} enabled`)}</span><Switch size="sm" aria-label={tr(`${regionLabel(group.region)}全部目标`, `All ${regionLabel(group.region)} targets`)} isSelected={onCount === group.targets.length} isDisabled={unavailable} onValueChange={value => void change(group.targets.map(target => target.id), value)}/></div>
              </div>
              <AnimatePresence initial={false}>
                {open && <motion.div key="targets" id={id} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduceMotion ? 0 : 0.14}}>
                  <div className="target-carrier-list">
                    {group.matches.map(target => <div className="target-carrier-row" key={target.id}>
                      <div className="target-carrier-identity"><strong>{target.name}</strong><span>{carrierLabel(target.carrier)}</span></div>
                      <code className="target-endpoint">{target.host}<span>:{target.port}</span></code>
                      <div className="target-carrier-controls">
                        <Switch size="sm" aria-label={tr(`${target.name}启用状态`, `${target.name} enabled`)} isSelected={target.enabled} isDisabled={unavailable} onValueChange={value => void change([target.id], value)}/>
                        <Button isIconOnly size="sm" variant="light" aria-label={tr(`编辑${target.name}`, `Edit ${target.name}`)} isDisabled={busy} onPress={() => {setCurrent(target); edit.onOpen();}}><Pencil size={15}/></Button>
                        <Button isIconOnly size="sm" color="danger" variant="light" aria-label={tr(`删除${target.name}`, `Delete ${target.name}`)} isDisabled={unavailable} onPress={() => void remove(target)}><Trash2 size={15}/></Button>
                      </div>
                    </div>)}
                  </div>
                </motion.div>}
              </AnimatePresence>
            </section>;
          })}
          {!filtered.length && <div className="target-empty">{loading ? tr("加载中…", "Loading…") : targets.length ? tr("没有匹配目标，试试其他关键词。", "No matching targets. Try another search.") : tr("还没有监控目标，可恢复默认目标或添加自定义地址。", "No targets yet. Restore defaults or add a custom endpoint.")}</div>}
          <div className="table-footer"><span>{tr(`${filtered.length} 个地区 · ${filtered.reduce((sum, group) => sum + group.matches.length, 0)} 个目标`, `${filtered.length} regions · ${filtered.reduce((sum, group) => sum + group.matches.length, 0)} targets`)}</span>{pages > 1 && <Pagination aria-label={tr("地区分页", "Region pages")} total={pages} page={page} onChange={setPage} showControls size="sm"/>}</div>
        </CardBody>
      </Card>
      <TargetModal target={current} disclosure={edit} onSaved={() => {edit.onClose(); void load(); onReload();}}/>
    </div>
  );
}

function TargetModal({
  target,
  disclosure,
  onSaved,
}: {
  target: MonitorTarget | null;
  disclosure: ReturnType<typeof useDisclosure>;
  onSaved: () => void;
}) {
  const { language, t } = useLanguage();
  const [form, setForm] = useState<Partial<MonitorTarget>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    setForm(
      target
        ? { ...target }
        : {
            name: "",
            host: "",
            port: 80,
            carrier: "ct",
            region: "河北",
            enabled: true,
          },
    );
  }, [target, disclosure.isOpen]);
  const set = (key: string, value: any) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
    const result = await API("/api/v1/admin/targets/save", {
      method: "POST",
      body: JSON.stringify({
        id: target?.id,
        name: form.name,
        host: form.host,
        port: Number(form.port || 80),
        carrier: form.carrier,
        region: form.region,
        enabled: form.enabled !== false,
      }),
    });
    if (!result.success) throw new Error(result.message || (language === "zh" ? "保存失败" : "Save failed"));
    onSaved();
    } catch (error) { setError(requestError(error)); }
    finally { setBusy(false); }
  };
  return (
    <Modal isOpen={disclosure.isOpen} onOpenChange={() => { if (!busy) disclosure.onOpenChange(); }} isDismissable={!busy} isKeyboardDismissDisabled={busy} hideCloseButton={busy} scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{target ? (language === "zh" ? "编辑监控目标" : "Edit target") : (language === "zh" ? "添加监控目标" : "Add target")}</ModalHeader>
        <ModalBody>
          {error && <Alert color="danger" title={error} />}
          <div className="form-grid">
            <Input
              label={language === "zh" ? "目标名称" : "Target name"}
              value={form.name || ""}
              onValueChange={(v) => set("name", v)}
            />
            <Input
              label={language === "zh" ? "IP / 域名" : "IP / domain"}
              value={form.host || ""}
              onValueChange={(v) => set("host", v)}
            />
            <Input
              label={t("targets.port", "端口")}
              type="number"
              value={String(form.port || 80)}
              onValueChange={(v) => set("port", v)}
            />
            <Input
              label={t("common.region", "地区")}
              value={form.region || ""}
              onValueChange={(v) => set("region", v)}
            />
            <Select
              label={t("targets.carrier", "运营商")}
              selectedKeys={[form.carrier || "ct"]}
              onSelectionChange={(keys) => set("carrier", String([...keys][0]))}
            >
              <SelectItem key="ct">{language === "zh" ? "电信" : "China Telecom"}</SelectItem>
              <SelectItem key="cu">{language === "zh" ? "联通" : "China Unicom"}</SelectItem>
              <SelectItem key="cm">{language === "zh" ? "移动" : "China Mobile"}</SelectItem>
              <SelectItem key="intl">{language === "zh" ? "国际" : "International"}</SelectItem>
            </Select>
            <Switch
              isSelected={form.enabled !== false}
              onValueChange={(v) => set("enabled", v)}
            >
              {language === "zh" ? "启用目标" : "Enable target"}
            </Switch>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={disclosure.onClose} isDisabled={busy}>
            {language === "zh" ? "取消" : "Cancel"}
          </Button>
          <Button color="primary" onPress={save} isLoading={busy} isDisabled={!form.name?.trim() || !form.host?.trim()}>
            {t("common.save", "保存")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
