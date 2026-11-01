import { Input, Switch } from "@heroui/react";

export type ResourceRules = {
  memory: boolean; memory_percent: number; disk: boolean; disk_percent: number;
  load: boolean; load_per_core: number; loss: boolean; loss_percent: number;
  billing: boolean; billing_days: number;
};

export function AlertRuleFields({rules={memory:false,memory_percent:90,disk:false,disk_percent:90,load:false,load_per_core:1,loss:false,loss_percent:20,billing:false,billing_days:7},onChange,language}:{rules:ResourceRules;onChange:(rules:ResourceRules)=>void;language:"zh"|"en"}) {
  const tr=(zh:string,en:string)=>language==="zh"?zh:en;
  const set=(key:keyof ResourceRules,value:number|boolean)=>onChange({...rules,[key]:value});
  return <div className="resource-rule-fields">
    <p className="text-small text-default-500">{tr("资源告警连续 3 次检查超限后通知，30 分钟内不重复发送。节点编辑中也需启用对应规则。","Resource alerts require 3 consecutive checks, with a 30-minute cooldown. Enable matching rules in each node’s editor.")}</p>
    {([
      ["memory","memory_percent",tr("内存使用率","Memory usage"),"%",1,100],
      ["disk","disk_percent",tr("磁盘使用率","Disk usage"),"%",1,100],
      ["load","load_per_core",tr("每核心 1 分钟负载","1-minute load per CPU core"),"",0.1,100],
      ["loss","loss_percent",tr("TCP 探测失败率","TCP probe failure rate"),"%",1,100],
      ["billing","billing_days",tr("到期前提醒","Renewal reminder"),tr("天","days"),0,90],
    ] as const).map(([enabled,threshold,label,unit,min,max])=><div className="resource-rule-row" key={enabled}>
      <Switch aria-label={label} isSelected={!!rules[enabled]} onValueChange={value=>set(enabled,value)}>{label}</Switch>
      <Input size="sm" type="number" aria-label={`${label} ${tr("阈值","threshold")}`} min={min} max={max} step={threshold==="load_per_core"?0.1:1} value={String(rules[threshold])} onValueChange={value=>set(threshold,Number(value))} endContent={<span className="text-small text-default-400">{unit}</span>} />
    </div>)}
    <p className="text-small text-default-500">{tr("TCP 失败率使用最近 5 分钟、至少 3 次历史采样，包含连接失败与超时；不是 ICMP 丢包率。续费只提醒，不会假定已付款或自动延后到期日。","TCP failures use at least 3 stored samples in the last 5 minutes, including timeouts and connection failures. This is not ICMP packet loss. Renewal dates advance only when you update them after payment.")}</p>
  </div>;
}
