import {useConfirm} from "./ConfirmProvider";
import {countryCodes} from "./countries";
import { useEffect, useMemo, useState } from "react";
import { Autocomplete, AutocompleteItem, Alert, Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Switch, Textarea, useDisclosure } from "@heroui/react";
import { Clipboard } from "lucide-react";
import { API, requestError, copyText, flag, type ServerNode, type Target } from "../lib";

type Props = { node: ServerNode | null; language: "zh" | "en"; disclosure: ReturnType<typeof useDisclosure>; onSaved: (close: boolean) => void };
export function NodeEditor({ node, language, disclosure, onSaved }: Props) {
  const tr = (zh: string, en: string) => language === "zh" ? zh : en;
  const [form, setForm] = useState<Partial<ServerNode>>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newId, setNewId] = useState("");
  const [install, setInstall] = useState("");
  const [installToken,setInstallToken]=useState("");
  const [platform,setPlatform]=useState("linux");
  const [targetSearch,setTargetSearch]=useState("");
  const confirmAction=useConfirm();
  const countries=useMemo(()=>{const names=new Intl.DisplayNames([language==="zh"?"zh-CN":"en"],{type:"region"});return countryCodes.filter(code=>!["XX","PC"].includes(code)).map(code=>({code,name:names.of(code)||code})).sort((a,b)=>a.name.localeCompare(b.name,language));},[language]);
  const [usedGb, setUsedGb] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetError, setTargetError] = useState("");
  const [targetRetry, setTargetRetry] = useState(0);
  const set = (key: keyof ServerNode, value: unknown) => setForm(current => ({ ...current, [key]: value }));
  const command = (token: string) => `curl -fsSL -H 'Authorization: Bearer ${token}' '${location.origin}/install.sh' | sudo bash`;
  useEffect(() => {
    setForm(node ? { ...node, ipv4: node.ipv4_override ?? node.ipv4, ipv6: node.ipv6_override ?? node.ipv6 } : { name: "", tags: "", monitor_enabled: false, route_enabled: false, alert_enabled: false, alert_offline: false, alert_cpu: false, alert_traffic: false });
    setMessage(""); setSuccess(false); setNewId(""); setUsedGb("");
    const token = (node as (ServerNode & { token?: string }) | null)?.token;
    setInstallToken(token||"");
    setInstall(token ? command(token) : "");
  }, [node, disclosure.isOpen]);
  useEffect(() => {
    if (!node || !disclosure.isOpen) return;
    const controller = new AbortController();
    setTargetError("");
    API("/api/v1/admin/targets", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setTargets(value); })
      .catch(error => { if (!controller.signal.aborted) setTargetError(requestError(error)); });
    return () => controller.abort();
  }, [!!node, disclosure.isOpen, targetRetry]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage(""); setSuccess(false);
    try { await operation(); } catch (error) { setMessage(requestError(error)); }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const result = await API(node ? "/api/v1/admin/servers/update" : "/api/v1/admin/servers/add", { method: "POST", body: JSON.stringify(form) });
    if (!result.success) throw new Error(result.message || tr("保存失败", "Save failed"));
    setSuccess(true); setMessage(tr("节点已保存", "Node saved"));
    setNewId(result.id || "");
    if (result.token) {setInstallToken(result.token);setInstall(command(result.token));}
    onSaved(!!node);
  });
  const resetToken = async () => {
    if (!node || !await confirmAction({title:tr("重置节点令牌","Reset node token"),body:tr(`重置「${node.name}」的令牌？当前 Agent 将断开，需要重新安装或更新令牌。`,`Reset the token for "${node.name}"? The current Agent will disconnect and need its token updated.`),danger:true})) return;
    return run(async () => {
      const result = await API("/api/v1/admin/servers/reset_token", { method: "POST", body: JSON.stringify({ id: node.id }) });
      if (!result.success) throw new Error(result.message || tr("重置失败", "Reset failed"));
      setInstallToken(result.token);setInstall(command(result.token)); setSuccess(true); setMessage(tr("令牌已重置，请使用新的安装命令", "Token reset. Use the new installation command."));
      onSaved(false);
    });
  };
  const calibrate = () => run(async () => {
    const value = Number(usedGb);
    if (!usedGb.trim() || !Number.isFinite(value) || value < 0) throw new Error(tr("请输入有效的已用流量", "Enter a valid traffic value"));
    const result = await API("/api/v1/admin/servers/calibrate", { method: "POST", body: JSON.stringify({ id: node?.id || newId, used_gb: value }) });
    if (!result.success) throw new Error(result.message || tr("校准失败", "Calibration failed"));
    setSuccess(true); setMessage(tr("流量已校准", "Traffic calibrated")); onSaved(false);
  });
  const windowsCommand=`& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing -Headers @{Authorization='Bearer ${installToken}'} '${location.origin}/install.ps1').Content))`;
  const activeCommand=platform==="windows"?windowsCommand:install;
  return <Modal isOpen={disclosure.isOpen} onOpenChange={() => { if (!busy) disclosure.onOpenChange(); }} size={node ? "3xl" : "2xl"} scrollBehavior="inside" isDismissable={!busy} isKeyboardDismissDisabled={busy} hideCloseButton={busy}>
    <ModalContent className={`node-modal-content ${node ? "node-modal-edit" : "node-modal-create"}`}>
      <ModalHeader>{node ? tr("编辑节点", "Edit node") : tr("添加节点", "Add node")}</ModalHeader>
      <ModalBody className="node-modal-body">
        <div className="form-grid">
          <Input label={tr("节点名称", "Node name")} value={form.name || ""} onValueChange={value => set("name", value)} isRequired maxLength={64} />
          <Input label={tr("标签（逗号分隔）", "Tags (comma-separated)")} value={form.tags || ""} onValueChange={value => set("tags", value)} />
          {node && <>
            <Input label="IPv4" placeholder={node.ipv4 || tr("自动识别", "Automatic")} description={tr("留空使用 Agent 连接地址", "Leave empty to use the Agent connection address")} value={form.ipv4 || ""} onValueChange={v => set("ipv4", v)} />
            <Input label="IPv6" placeholder={node.ipv6 || tr("自动识别", "Automatic")} description={tr("手动地址不会被心跳覆盖", "Manual addresses are preserved across heartbeats")} value={form.ipv6 || ""} onValueChange={v => set("ipv6", v)} />
            <Switch isSelected={!!form.public_ip} onValueChange={v=>set("public_ip",v)}>{tr("在前台公开 IP 地址","Show IP addresses publicly")}</Switch>
            <Autocomplete label={tr("国家/地区", "Country / region")} selectedKey={(form.region||"").toUpperCase()||null} onSelectionChange={key=>{if(!key)return;const code=String(key);setForm(current=>({...current,region:code.toLowerCase(),region_name:new Intl.DisplayNames(["zh-CN"],{type:"region"}).of(code)||code,region_name_en:new Intl.DisplayNames(["en"],{type:"region"}).of(code)||code}));}}>
              {countries.map(c=><AutocompleteItem key={c.code} textValue={`${c.name} ${c.code}`} startContent={<img src={flag(c.code)} className="flag-mini" alt=""/>}>{c.name} ({c.code})</AutocompleteItem>)}
            </Autocomplete>
            <Input label={tr("地区名称", "Region name")} value={form.region_name || ""} onValueChange={v => set("region_name", v)} />
            <Input label={tr("地区英文名", "Region name in English")} value={form.region_name_en || ""} onValueChange={v => set("region_name_en", v)} />
            <Input label={tr("服务商", "Provider")} value={form.provider || ""} onValueChange={v => set("provider", v)} />
            <Input label={tr("价格", "Price")} type="number" min={0} value={String(form.billing_price ?? 0)} onValueChange={v => set("billing_price", Number(v))} />
            <Select label={tr("计费币种", "Billing currency")} selectedKeys={[form.billing_currency_code || "USD"]} onSelectionChange={keys => {const code=String([...keys][0]);const symbol=({USD:"$",CNY:"¥",JPY:"¥",EUR:"€",GBP:"£",HKD:"HK$",SGD:"S$",AUD:"A$",CAD:"C$",RUB:"₽"} as Record<string,string>)[code]||code;setForm(current=>({...current,billing_currency_code:code,billing_currency:symbol}));}}>
              {["USD", "CNY", "EUR", "GBP", "JPY", "HKD", "SGD", "AUD", "CAD", "RUB"].map(code => <SelectItem key={code}>{code}</SelectItem>)}
            </Select>
            <Select label={tr("付费周期", "Billing cycle")} selectedKeys={[form.billing_cycle || "monthly"]} onSelectionChange={keys => set("billing_cycle", String([...keys][0]))}>
              {[["monthly", "月付", "Monthly"], ["quarterly", "季付", "Quarterly"], ["semi_annually", "半年付", "Semiannually"], ["annually", "年付", "Annually"], ["biennially", "两年付", "Every two years"], ["triennially", "三年付", "Every three years"], ["lifetime", "永久", "Lifetime"], ["free", "免费", "Free"]].map(([key, zh, en]) => <SelectItem key={key}>{tr(zh, en)}</SelectItem>)}
            </Select>
            <Input label={tr("到期日期", "Renewal date")} type="date" value={form.renewal_date || ""} onValueChange={v => set("renewal_date", v)} />
            <Input label={tr("流量配额（GiB）", "Traffic allowance (GiB)")} type="number" min={0} value={String(form.traffic_limit_gb ?? 0)} onValueChange={v => set("traffic_limit_gb", Number(v))} />
            <Select label={tr("流量计费方式", "Traffic billing")} selectedKeys={[form.traffic_type || "outbound"]} onSelectionChange={keys => set("traffic_type", String([...keys][0]))}>
              <SelectItem key="outbound">{tr("仅出站", "Outbound only")}</SelectItem><SelectItem key="both">{tr("入站 + 出站", "Inbound + outbound")}</SelectItem>
            </Select>
            <Input label={tr("每月流量重置日", "Monthly traffic reset day")} description={tr("按主控系统时区自动重置；月底不足该日时按月末计算", "Resets in the server time zone; shorter months use their last day")} type="number" min={1} max={31} value={String(form.traffic_reset_day ?? 1)} onValueChange={v => set("traffic_reset_day", Number(v))} />
          </>}
        </div>
        <section className="form-section node-control-section">
          <h4>{tr("监控", "Monitoring")}</h4>
          <div className="switch-grid">
            <Switch isSelected={!!form.monitor_enabled} onValueChange={v => set("monitor_enabled", v)}>{tr("延迟监控", "Latency monitoring")}</Switch>
            <Switch isSelected={!!form.route_enabled} onValueChange={v => set("route_enabled", v)}>{tr("回程检测", "Return-route monitoring")}</Switch>
          </div>
          {node && <div className="form-grid mt-4">
            <Select label={tr("监控目标范围", "Monitoring scope")} isDisabled={!form.monitor_enabled} selectedKeys={[form.monitor_mode || "all"]} onSelectionChange={keys => set("monitor_mode", String([...keys][0]))}>
              <SelectItem key="all">{tr("全部启用目标", "All enabled targets")}</SelectItem><SelectItem key="selected">{tr("指定目标", "Selected targets")}</SelectItem>
            </Select>
            {form.monitor_mode === "selected" && <><Input label={tr("搜索监控目标","Search targets")} value={targetSearch} onValueChange={setTargetSearch}/><Select label={tr("监控目标", "Monitoring targets")} isDisabled={!form.monitor_enabled || !!targetError} selectionMode="multiple" selectedKeys={(form.monitor_targets || "").split(",").filter(Boolean)} onSelectionChange={keys => set("monitor_targets", [...keys].join(","))}>
              {targets.filter(target => ((target.enabled && `${target.name} ${target.host} ${target.region}`.toLowerCase().includes(targetSearch.toLowerCase())) || (form.monitor_targets || "").split(",").includes(String(target.id)))).map(target => <SelectItem key={String(target.id)} textValue={target.name}>{target.name}</SelectItem>)}
            </Select>{!form.monitor_targets && <p className="text-small text-warning">{tr("请选择至少一个目标后再启用探测","Select at least one target before enabling probes")}</p>}</>}
            {targetError && <div role="alert"><p>{targetError}</p><Button size="sm" variant="flat" onPress={() => setTargetRetry(value => value + 1)}>{tr("重试", "Retry")}</Button></div>}
          </div>}
        </section>
        <section className="form-section node-control-section">
          <div className="node-alert-heading"><h4>{tr("节点告警", "Node alerts")}</h4><Switch aria-label={tr("接收节点告警", "Receive node alerts")} isSelected={!!form.alert_enabled} onValueChange={v => set("alert_enabled", v)} size="sm" /></div>
          <div className="switch-grid node-alert-options">
            <Switch isDisabled={!form.alert_enabled} isSelected={!!form.alert_offline} onValueChange={v => set("alert_offline", v)}>{tr("离线告警", "Offline alerts")}</Switch>
            <Switch isDisabled={!form.alert_enabled} isSelected={!!form.alert_cpu} onValueChange={v => set("alert_cpu", v)}>{tr("CPU 告警", "CPU alerts")}</Switch>
            <Switch isDisabled={!form.alert_enabled} isSelected={!!form.alert_traffic} onValueChange={v => set("alert_traffic", v)}>{tr("流量告警", "Traffic alerts")}</Switch>
            {node && ([ ["memory","内存告警","Memory alerts"], ["disk","磁盘告警","Disk alerts"], ["load","负载告警","Load alerts"], ["loss","TCP 探测失败告警","TCP failure alerts"], ["billing","续费提醒","Renewal reminders"] ] as const).map(([key,zh,en])=><Switch key={key} isDisabled={!form.alert_enabled} isSelected={!!form.alert_rules?.[key]} onValueChange={value=>set("alert_rules",{...form.alert_rules,[key]:value})}>{tr(zh,en)}</Switch>)}
          </div>
        </section>
        {message && <Alert color={success ? "success" : "danger"} title={message} />}
        {install && <section className="form-section"><h4>{tr("安装 Agent", "Install agent")}</h4>
          <Select label={tr("安装平台","Platform")} selectedKeys={[platform]} onSelectionChange={keys=>setPlatform(String([...keys][0]))} disallowEmptySelection><SelectItem key="linux">Linux</SelectItem><SelectItem key="windows">Windows (PowerShell)</SelectItem></Select>
          <Textarea label={platform==="windows"?tr("Windows 安装命令","Windows installation command"):tr("Linux 安装命令", "Linux installation command")} value={activeCommand} minRows={2} isReadOnly />
          <div className="toolbar-actions"><Button variant="flat" isDisabled={busy} startContent={<Clipboard size={15} />} onPress={() => run(async () => { await copyText(activeCommand); setSuccess(true); setMessage(tr("安装命令已复制", "Installation command copied")); })}>{tr("复制命令", "Copy command")}</Button></div>
        </section>}
        {node && <Button className="node-token-reset" size="sm" color="warning" variant="light" onPress={resetToken} isDisabled={busy}>{tr("重置节点令牌", "Reset node token")}</Button>}
        {(node || newId) && <section className="form-section"><h4>{tr("流量校准", "Traffic calibration")}</h4>
          <div className="toolbar-actions"><Input type="number" min={0} label={tr("已用流量（GiB，1 GiB = 1024³ 字节）", "Traffic used (GiB, 1 GiB = 1024³ bytes)")} value={usedGb} onValueChange={setUsedGb} /><Button variant="flat" onPress={calibrate} isDisabled={busy}>{tr("校准", "Calibrate")}</Button></div>
        </section>}
      </ModalBody>
      <ModalFooter><Button variant="flat" onPress={disclosure.onClose} isDisabled={busy}>{tr("关闭", "Close")}</Button><Button color="primary" onPress={save} isLoading={busy} isDisabled={!form.name?.trim() || (!node && !!newId)}>{!node && newId ? tr("节点已创建", "Node created") : tr("保存节点", "Save node")}</Button></ModalFooter>
    </ModalContent>
  </Modal>;
}
