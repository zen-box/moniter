import {createContext,useContext,useRef,useState,type ReactNode} from "react";
import {Button,Modal,ModalContent,ModalHeader,ModalBody,ModalFooter} from "@heroui/react";
type Request={title:string;body:string;danger?:boolean};
const Context=createContext<(request:Request)=>Promise<boolean>>(()=>Promise.resolve(false));
export const useConfirm=()=>useContext(Context);
export function ConfirmProvider({children,language}:{children:ReactNode;language:"zh"|"en"}) {
  const [request,setRequest]=useState<Request|null>(null);
  const resolve=useRef<((value:boolean)=>void)|null>(null);
  const close=(result:boolean)=>{resolve.current?.(result);resolve.current=null;setRequest(null)};
  const confirm=(next:Request)=>new Promise<boolean>(done=>{resolve.current?.(false);resolve.current=done;setRequest(next)});
  return <Context.Provider value={confirm}>{children}<Modal isOpen={!!request} onOpenChange={open=>!open&&close(false)} size="md"><ModalContent>
    <ModalHeader>{request?.title}</ModalHeader><ModalBody><p>{request?.body}</p></ModalBody>
    <ModalFooter><Button variant="flat" onPress={()=>close(false)}>{language==="zh"?"取消":"Cancel"}</Button><Button color={request?.danger?"danger":"primary"} onPress={()=>close(true)}>{language==="zh"?"确认":"Confirm"}</Button></ModalFooter>
  </ModalContent></Modal></Context.Provider>
}
