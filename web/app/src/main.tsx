import {lazy,Suspense} from "react";
import {createRoot} from "react-dom/client";
import {LanguageProvider,useLanguage} from "./runtime";
import "./styles.css";
import "./public/public.css";
// The console brings its own component library; the public status page stays light.
const Console=lazy(()=>import("./admin/Console"));
const Public=lazy(()=>import("./public/PublicRoute"));
function Routes(){const {language}=useLanguage();return <Suspense fallback={<div className="boot-shell"><div className="boot-mark" role="status" aria-label={language==="zh"?"加载中":"Loading"}/></div>}>{location.pathname.startsWith("/admin")?<Console/>:<Public/>}</Suspense>}
createRoot(document.getElementById("root")!).render(<LanguageProvider><Routes/></LanguageProvider>);
