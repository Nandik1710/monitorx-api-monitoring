import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";
import { useConfirm } from "@monitorx/ui";

export function useUnsavedChanges() {
  const dirty = useRef(false);
  const confirm = useConfirm();
  const blocker = useBlocker(useCallback(() => dirty.current, []));
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let active = true;
    void confirm("Leave this page and discard your unsaved test changes?").then(
      (leave) => {
        if (!active) return;
        if (leave) blocker.proceed();
        else blocker.reset();
      },
    );
    return () => {
      active = false;
    };
  }, [blocker, confirm]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  return useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
}
