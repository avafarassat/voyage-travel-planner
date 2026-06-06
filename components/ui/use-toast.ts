"use client";

import * as React from "react";

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 4000;

type ToastProps = {
  id: string;
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
};

type Action =
  | { type: "ADD_TOAST"; toast: ToastProps }
  | { type: "DISMISS_TOAST"; toastId: string }
  | { type: "REMOVE_TOAST"; toastId: string };

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const addToRemoveQueue = (toastId: string, dispatch: React.Dispatch<Action>) => {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: "REMOVE_TOAST", toastId });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
};

function reducer(state: ToastProps[], action: Action): ToastProps[] {
  switch (action.type) {
    case "ADD_TOAST":
      return [action.toast, ...state].slice(0, TOAST_LIMIT);
    case "DISMISS_TOAST":
      return state.filter((t) => t.id !== action.toastId);
    case "REMOVE_TOAST":
      return state.filter((t) => t.id !== action.toastId);
    default:
      return state;
  }
}

const listeners: Array<(state: ToastProps[]) => void> = [];
let memoryState: ToastProps[] = [];

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
}

export function toast(props: Omit<ToastProps, "id">) {
  const id = genId();
  dispatch({ type: "ADD_TOAST", toast: { ...props, id } });
  addToRemoveQueue(id, dispatch);
  return { id };
}

export function useToast() {
  const [state, setState] = React.useState<ToastProps[]>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    toasts: state,
    toast,
    dismiss: (toastId: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  };
}
