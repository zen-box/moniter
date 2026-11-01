import {lazy,Suspense} from "react";
import {createRoot} from "react-dom/client";
import {HeroUIProvider} from "@heroui/react";
import {MotionConfig,useReducedMotion} from "framer-motion";
import {LanguageProvider,useLanguage} from "./runtime";
import {ConfirmProvider} from "./admin/ConfirmProvider";
import "./styles.css";
import "./public/public.css";
const Console=lazy(()=>import("./admin/Console"));
const Public=lazy(()=>import("./public/PublicRoute"));
function Routes(){const {language}=useLanguage();return <ConfirmProvider language={language}><Suspense fallback={<div className="boot-shell"><div className="boot-mark" role="status" aria-label={language==="zh"?"加载中":"Loading"}/></div>}>{location.pathname.startsWith("/admin")?<Console/>:<Public/>}</Suspense></ConfirmProvider>}
function App(){const reduced=useReducedMotion();return <HeroUIProvider disableAnimation={!!reduced}><MotionConfig reducedMotion="user"><LanguageProvider><Routes/></LanguageProvider></MotionConfig></HeroUIProvider>}
createRoot(document.getElementById("root")!).render(<App/>);
