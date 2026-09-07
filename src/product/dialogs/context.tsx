import { createContext, useContext } from 'react';
import type { Experiment, Finding } from '../types';

export interface ProductDialogs {
  openConnect: () => void;
  openTest: (finding: Finding | null) => void;
  openPrepare: (experiment: Experiment) => void;
}

export const DialogsContext = createContext<ProductDialogs>({ openConnect: () => undefined, openTest: () => undefined, openPrepare: () => undefined });

export function useProductDialogs() {
  return useContext(DialogsContext);
}
