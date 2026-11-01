use serde::Serialize;
use std::time::{Duration, Instant};
use sysinfo::{
    CpuRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessesToUpdate, RefreshKind, System,
};

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub os_name: String,
    pub kernel_ver: String,
    /// 架构，例如 x86_64 / aarch64
    pub arch: String,
    /// 虚拟化类型，物理机为 Bare Metal
    pub virtualization: String,
    /// 显卡型号（启动时探测一次）
    pub gpu: String,
    pub cpu_model: String,
    pub cpu_cores: usize,
    pub cpu_usage: f32,
    pub mem_used_bytes: u64,
    pub mem_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub net_in_speed_bytes: u64,
    pub net_out_speed_bytes: u64,
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
    pub uptime_secs: u64,
    /// TCP / UDP 连接数
    pub tcp_conns: u32,
    pub udp_conns: u32,
    /// 进程总数
    pub processes: u32,
    /// 1 / 5 / 15 分钟平均负载（Windows 上恒为 0，系统不提供）
    pub load1: f32,
    pub load5: f32,
    pub load15: f32,
}

/// 连接数和进程数在 Windows 上要跑外部命令，开销较大，
/// 所以按 30 秒缓存一次，其余心跳复用上次结果。
const SLOW_METRIC_INTERVAL: Duration = Duration::from_secs(30);

pub struct Collector {
    sys: System,
    networks: Networks,
    disks: Disks,
    interface_counters: std::collections::HashMap<String,(u64,u64)>,
    included_interfaces: Option<std::collections::HashSet<String>>,
    last_rx: u64,
    last_tx: u64,
    last_time: Instant,
    // 启动时探测一次，之后不变
    gpu: String,
    virtualization: String,
    // 慢指标缓存
    tcp_conns: u32,
    udp_conns: u32,
    processes: u32,
    last_slow_refresh: Option<Instant>,
}

impl Collector {
    pub fn new() -> Self {
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        // CPU 使用率需要两次采样才有意义，先刷一次打底
        sys.refresh_cpu_all();
        sys.refresh_memory();

        let networks = Networks::new_with_refreshed_list();
        let disks = Disks::new_with_refreshed_list();

        let included_interfaces=std::env::var("AEGIS_NETWORK_INTERFACES").ok().map(|v|v.split(',').map(str::trim).filter(|s|!s.is_empty()).map(str::to_owned).collect());
        let interface_counters=networks.iter().filter(|(name,_)|include_interface(name,&included_interfaces)).map(|(name,net)|(name.clone(),(net.total_received(),net.total_transmitted()))).collect();

        Self {
            sys,
            networks,
            disks,
            interface_counters,
            included_interfaces,
            last_rx: 0,
            last_tx: 0,
            last_time: Instant::now(),
            gpu: detect_gpu(),
            virtualization: detect_virtualization(),
            tcp_conns: 0,
            udp_conns: 0,
            processes: 0,
            last_slow_refresh: None,
        }
    }

    pub fn collect(&mut self) -> SystemStats {
        self.sys.refresh_cpu_all();
        self.sys.refresh_memory();
        self.networks.refresh(true);
        self.disks.refresh(true);

        // 慢指标：连接数 / 进程数，30 秒刷新一次
        let need_slow = self
            .last_slow_refresh
            .map(|t| t.elapsed() >= SLOW_METRIC_INTERVAL)
            .unwrap_or(true);

        if need_slow {
            let (tcp, udp) = count_connections();
            self.tcp_conns = tcp;
            self.udp_conns = udp;
            self.processes = self.sys.refresh_processes(ProcessesToUpdate::All, true) as u32;
            self.last_slow_refresh = Some(Instant::now());
        }

        let cpu_usage = self.sys.global_cpu_usage();
        let cpu_cores = self.sys.cpus().len();
        let cpu_model = self
            .sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "Unknown CPU".to_string());

        let mem_used_bytes = self.sys.used_memory();
        let mem_total_bytes = self.sys.total_memory();
        let swap_used_bytes = self.sys.used_swap();
        let swap_total_bytes = self.sys.total_swap();

        let mut disk_used = 0;
        let mut disk_total = 0;
        let mut devices=std::collections::HashSet::new();
        for d in &self.disks {
            if matches!(d.file_system().to_string_lossy().as_ref(), "overlay"|"tmpfs"|"devtmpfs"|"proc"|"sysfs"|"squashfs") {continue;}
            #[cfg(target_os="linux")]
            let key=d.name().to_os_string();
            #[cfg(not(target_os="linux"))]
            let key=d.mount_point().as_os_str().to_os_string();
            if !devices.insert(key) {continue;}
            disk_total += d.total_space();
            disk_used += d.total_space().saturating_sub(d.available_space());
        }

        let now = Instant::now();
        let elapsed = now.duration_since(self.last_time).as_secs_f64().max(0.1);
        self.last_time = now;

        let mut delta_rx=0u64;let mut delta_tx=0u64;
        for (name, net) in &self.networks {
            if !include_interface(name,&self.included_interfaces) {continue;}
            let current=(net.total_received(),net.total_transmitted());
            if let Some(previous)=self.interface_counters.insert(name.clone(),current) {
                delta_rx=delta_rx.saturating_add(if current.0>=previous.0 {current.0-previous.0}else{current.0});
                delta_tx=delta_tx.saturating_add(if current.1>=previous.1 {current.1-previous.1}else{current.1});
            }
        }
        self.last_rx=self.last_rx.saturating_add(delta_rx);self.last_tx=self.last_tx.saturating_add(delta_tx);
        let current_total_rx=self.last_rx;let current_total_tx=self.last_tx;
        let in_speed=(delta_rx as f64/elapsed) as u64;let out_speed=(delta_tx as f64/elapsed) as u64;

        let load = System::load_average();

        SystemStats {
            os_name: System::long_os_version().unwrap_or_else(|| "Linux/Unix".to_string()),
            kernel_ver: System::kernel_version().unwrap_or_default(),
            arch: std::env::consts::ARCH.to_string(),
            virtualization: self.virtualization.clone(),
            gpu: self.gpu.clone(),
            cpu_model,
            cpu_cores,
            cpu_usage,
            mem_used_bytes,
            mem_total_bytes,
            swap_used_bytes,
            swap_total_bytes,
            disk_used_bytes: disk_used,
            disk_total_bytes: disk_total,
            net_in_speed_bytes: in_speed,
            net_out_speed_bytes: out_speed,
            total_rx_bytes: current_total_rx,
            total_tx_bytes: current_total_tx,
            uptime_secs: System::uptime(),
            tcp_conns: self.tcp_conns,
            udp_conns: self.udp_conns,
            processes: self.processes,
            load1: load.one as f32,
            load5: load.five as f32,
            load15: load.fifteen as f32,
        }
    }
}

/// Exact allowlist overrides defaults for bridges/tunnels that are intentionally billed.
fn include_interface(name:&str, allow:&Option<std::collections::HashSet<String>>)->bool {
    if let Some(names)=allow {return names.contains(name);}
    let n=name.to_ascii_lowercase();
    n!="lo" && !n.starts_with("lo:") && !(["loopback","docker","veth","br-","virbr","tun","tap","tailscale","wg","vboxnet","vmnet","vethernet","hyper-v","wsl"].iter().any(|prefix|n.starts_with(prefix)))
}

#[cfg(test)]
mod interface_tests {
    use super::*;
    #[test]
    fn virtual_interfaces_excluded_but_can_be_explicitly_included() {
        for name in ["lo","docker0","veth123","br-abc","tun0","vEthernet (WSL)"] {assert!(!include_interface(name,&None));}
        assert!(include_interface("eth0",&None));assert!(include_interface("ens3",&None));
        assert!(include_interface("Local Area Connection",&None));
        let allow=Some(["br0".to_string()].into_iter().collect());assert!(include_interface("br0",&allow));assert!(!include_interface("eth0",&allow));
    }
}

// ==========================================================================
// 平台相关的慢速探测（都只在启动时或 30 秒一次）
// ==========================================================================

#[cfg(target_os = "linux")]
fn count_connections() -> (u32, u32) {
    // /proc/net/{tcp,tcp6,udp,udp6} 每行一条连接，首行是表头
    fn rows(path: &str) -> u32 {
        std::fs::read_to_string(path)
            .map(|s| s.lines().count().saturating_sub(1) as u32)
            .unwrap_or(0)
    }
    (
        rows("/proc/net/tcp") + rows("/proc/net/tcp6"),
        rows("/proc/net/udp") + rows("/proc/net/udp6"),
    )
}

#[cfg(windows)]
fn count_connections() -> (u32, u32) {
    // netstat 输出每行一条连接，比 winapi 省事且够用
    match std::process::Command::new("netstat").arg("-ano").output() {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut tcp = 0;
            let mut udp = 0;
            for line in text.lines() {
                let t = line.trim_start();
                if t.starts_with("TCP") {
                    tcp += 1;
                } else if t.starts_with("UDP") {
                    udp += 1;
                }
            }
            (tcp, udp)
        }
        Err(_) => (0, 0),
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
fn count_connections() -> (u32, u32) {
    (0, 0)
}

#[cfg(target_os = "linux")]
fn detect_virtualization() -> String {
    // systemd-detect-virt 最准，容器里也能识别
    if let Ok(out) = std::process::Command::new("systemd-detect-virt").output() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() && s != "none" {
            return s;
        }
    }
    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        if cpuinfo.contains("hypervisor") {
            return "Virtualized".to_string();
        }
    }
    "Bare Metal".to_string()
}

#[cfg(windows)]
fn detect_virtualization() -> String {
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_ComputerSystem).Model",
        ])
        .output();

    if let Ok(o) = out {
        let model = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !model.is_empty() {
            let low = model.to_lowercase();
            let vm_hints = [
                "virtual",
                "vmware",
                "kvm",
                "hyper-v",
                "hyperv",
                "bochs",
                "qemu",
                "xen",
                "parallels",
                "virtualbox",
            ];
            if vm_hints.iter().any(|h| low.contains(h)) {
                return model;
            }
            return "Bare Metal".to_string();
        }
    }
    String::new()
}

#[cfg(not(any(target_os = "linux", windows)))]
fn detect_virtualization() -> String {
    String::new()
}

#[cfg(windows)]
fn detect_gpu() -> String {
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)",
        ])
        .output();

    if let Ok(o) = out {
        let name = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    String::new()
}

#[cfg(target_os = "linux")]
fn detect_gpu() -> String {
    let out = std::process::Command::new("sh")
        .args([
            "-c",
            "lspci 2>/dev/null | grep -iE 'vga|3d|display' | head -1",
        ])
        .output();

    if let Ok(o) = out {
        let line = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if let Some(pos) = line.find(": ") {
            return line[pos + 2..].to_string();
        }
        return line;
    }
    String::new()
}

#[cfg(not(any(target_os = "linux", windows)))]
fn detect_gpu() -> String {
    String::new()
}
