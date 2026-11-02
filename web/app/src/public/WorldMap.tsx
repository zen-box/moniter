import { memo, useEffect, useMemo, useRef, useState } from "react";
import { type ServerNode } from "../lib";
import { useLanguage } from "../runtime";

const coords: Record<string, [number, number]> = {
  us: [190, 150],
  cn: [820, 160],
  de: [524, 110],
  jp: [888, 150],
  hk: [817, 188],
  sg: [788, 246],
  gb: [499, 107],
  au: [887, 330],
  fr: [500, 125],
  ca: [180, 100],
  ru: [700, 80],
};

// Parsing the world outline is the expensive part of showing the map; keep the
// results for the session so switching tabs back and forth stays instant.
let cachedPaths: Promise<string> | null = null;
let loadedPaths = "";
const loadPaths = () =>
  (cachedPaths ??= fetch("/world-map-paths.svg")
    .then((r) => (r.ok ? r.text() : ""))
    .then((text) => (loadedPaths = text))
    .catch(() => ""));
const litMarkup = new Map<string, string>();
let cachedCenters: Record<string, [number, number]> | null = null;

function WorldMap({
  nodes,
  onSelect,
}: {
  nodes: ServerNode[];
  onSelect: (node: ServerNode) => void;
}) {
  const { t } = useLanguage();
  const [paths, setPaths] = useState(loadedPaths);
  const mapRef = useRef<SVGSVGElement>(null);
  const [countryCenters, setCountryCenters] = useState<Record<string, [number, number]>>(cachedCenters || {});
  useEffect(() => {
    let active = true;
    void loadPaths().then((value) => active && setPaths(value));
    return () => {
      active = false;
    };
  }, []);
  const regionKey = [...new Set(nodes.map((n) => n.region.toLowerCase()))].sort().join(",");
  const mapPaths = useMemo(() => {
    if (!paths) return "";
    const cached = litMarkup.get(regionKey);
    if (cached) return cached;
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${paths}</svg>`, "image/svg+xml");
    const lit = new Set(regionKey.split(","));
    doc.querySelectorAll("path[data-code]").forEach((path) => {
      if (lit.has(path.getAttribute("data-code") || "")) path.classList.add("lit");
    });
    const markup = doc.documentElement.innerHTML;
    if (litMarkup.size > 8) litMarkup.clear();
    litMarkup.set(regionKey, markup);
    return markup;
  }, [paths, regionKey]);
  useEffect(() => {
    if (cachedCenters || !mapPaths) return;
    const centers: Record<string, [number, number]> = {};
    mapRef.current?.querySelectorAll<SVGGraphicsElement>("path[data-code]").forEach((path) => {
      const box = path.getBBox();
      centers[path.getAttribute("data-code") || ""] = [box.x + box.width / 2, box.y + box.height / 2];
    });
    cachedCenters = centers;
    setCountryCenters(centers);
  }, [mapPaths]);
  // Nodes sharing a country fan out around its center instead of stacking.
  const pins = useMemo(() => {
    const groups = new Map<string, ServerNode[]>();
    for (const node of nodes) {
      const code = node.region.toLowerCase();
      groups.set(code, [...(groups.get(code) || []), node]);
    }
    return [...groups.entries()].flatMap(([code, members]) => {
      const center = coords[code] || countryCenters[code];
      if (!center) return [];
      return members.map((node, index) => {
        const angle = (index / members.length) * Math.PI * 2;
        const spread = members.length > 1 ? 9 : 0;
        return { node, x: center[0] + Math.cos(angle) * spread, y: center[1] + Math.sin(angle) * spread };
      });
    });
  }, [nodes, countryCenters]);
  return (
    <section className="mp-map-card">
      <header className="mp-map-header">
        <div>
          <h3>{t("map.title", "全球节点分布")}</h3>
          <p>{t("map.hint", "在线节点和区域分布")}</p>
        </div>
        <span className="mp-pill">
          {new Set(nodes.map((n) => n.region)).size} {t("map.regions", "个地区")}
        </span>
      </header>
      <div className="mp-map-body">
        <div className={`world-map ${paths ? "is-ready" : ""}`}>
          <svg ref={mapRef} viewBox="0 0 1000 500" role="img" aria-label={t("map.alt", "全球节点分布地图")} dangerouslySetInnerHTML={{ __html: mapPaths }} />
          {pins.map(({ node, x, y }) => (
            <button
              key={node.id}
              type="button"
              className={`map-pin ${node.status}`}
              style={{ left: `${x / 10}%`, top: `${y / 5}%` }}
              onClick={() => onSelect(node)}
              aria-label={node.name}
            >
              <span />
              <em>{node.name}</em>
            </button>
          ))}
          <div className="map-legend">
            <span>
              <i className="legend-online" />
              {t("public.online", "在线")}
            </span>
            <span>
              <i className="legend-offline" />
              {t("public.offline", "离线")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(WorldMap);
