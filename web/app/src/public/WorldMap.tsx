import {useEffect,useMemo,useRef,useState} from "react";
import {Card,CardHeader,CardBody,Chip} from "@heroui/react";
import {type ServerNode} from "../lib";
import {useLanguage} from "../runtime";
export default function WorldMap({
  nodes,
  onSelect,
}: {
  nodes: ServerNode[];
  onSelect: (node: ServerNode) => void;
}) {
  const { t } = useLanguage();
  const [paths, setPaths] = useState("");
  const mapRef = useRef<SVGSVGElement>(null);
  const [countryCenters, setCountryCenters] = useState<Record<string, [number, number]>>({});
  useEffect(() => {
    fetch("/world-map-paths.svg")
      .then((r) => r.text())
      .then(setPaths)
      .catch(() => {});
  }, []);
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
  const regionKey = [...new Set(nodes.map(n => n.region.toLowerCase()))].sort().join(",");
  const mapPaths = useMemo(() => {
    if (!paths) return "";
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${paths}</svg>`,
      "image/svg+xml",
    );
    doc.querySelectorAll("path[data-code]").forEach((path) => {
      if (regionKey.split(",").includes(path.getAttribute("data-code") || ""))
        path.classList.add("lit");
    });
    return doc.documentElement.innerHTML;
  }, [paths, regionKey]);
  useEffect(() => {
    const centers: Record<string, [number, number]> = {};
    mapRef.current?.querySelectorAll<SVGGraphicsElement>("path[data-code]").forEach(path => {
      const box = path.getBBox();
      centers[path.getAttribute("data-code") || ""] = [box.x + box.width / 2, box.y + box.height / 2];
    });
    setCountryCenters(centers);
  }, [mapPaths]);
  return (
    <Card className="map-card mp-map-card">
      <CardHeader className="mp-map-header">
        <div>
          <h3>{t("map.title", "全球节点分布")}</h3>
          <p>{t("map.hint", "在线节点和区域分布")}</p>
        </div>
        <Chip size="sm" color="primary" variant="flat">
          {new Set(nodes.map((n) => n.region)).size} {t("map.regions", "个地区")}
        </Chip>
      </CardHeader>
      <CardBody className="mp-map-body">
        <div className="world-map">
          <svg
            ref={mapRef}
            viewBox="0 0 1000 500"
            role="img"
            aria-label={t("map.alt", "全球节点分布地图")}
            dangerouslySetInnerHTML={{ __html: mapPaths }}
          />
          {nodes.map((node) => {
            const point = coords[node.region.toLowerCase()] || countryCenters[node.region.toLowerCase()];
            if (!point) return null;
            const [x, y] = point;
            return (
              <button
                key={node.id}
                className={`map-pin ${node.status}`}
                style={{ left: `${x / 10}%`, top: `${y / 5}%` }}
                onClick={() => onSelect(node)}
                aria-label={node.name}
              >
                <span />
              </button>
            );
          })}
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
      </CardBody>
    </Card>
  );
}

