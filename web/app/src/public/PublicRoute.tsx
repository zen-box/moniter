import {useLanguage,useSiteName,useTheme,initialServers} from "../runtime";
import {PublicDashboard} from "./PublicDashboard";
import WorldMap from "./WorldMap";
export default function PublicRoute(){const siteName=useSiteName();const {language,setLanguage}=useLanguage();const [theme,setTheme]=useTheme();
 return <PublicDashboard siteName={siteName} language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} initialNodes={initialServers()} renderMap={(nodes,onSelect)=><WorldMap nodes={nodes} onSelect={onSelect}/>}/>;
}
