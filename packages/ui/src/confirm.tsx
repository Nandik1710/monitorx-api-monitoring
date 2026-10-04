import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "./forms.js";
const ConfirmContext = createContext<(message: string) => Promise<boolean>>(
  async (message) => window.confirm(message),
);
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const resolve = useRef<((answer: boolean) => void) | null>(null);
  const request = useCallback(
    (text: string) =>
      new Promise<boolean>((done) => {
        resolve.current?.(false);
        resolve.current = done;
        setMessage(text);
      }),
    [],
  );
  function finish(answer: boolean) {
    resolve.current?.(answer);
    resolve.current = null;
    setMessage("");
  }
  useEffect(
    () => () => {
      resolve.current?.(false);
    },
    [],
  );
  return (
    <ConfirmContext.Provider value={request}>
      {children}
      <AlertDialog.Root
        open={!!message}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="dialog-backdrop" />
          <AlertDialog.Popup className="confirm-dialog">
            <span className="eyebrow">Confirm action</span>
            <AlertDialog.Title>Are you sure?</AlertDialog.Title>
            <AlertDialog.Description>{message}</AlertDialog.Description>
            <div className="dialog-actions">
              <Button onClick={() => finish(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => finish(true)}>
                Confirm
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
