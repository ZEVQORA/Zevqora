import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { cloudEngine, localEngine, syncLocalEngineSession, engineErrorMessage, type Engine } from './engine';
import { desktopBridge, isDesktop } from './bridge';
import { pickRepository, pickTraceFile, type PickedRepository } from './browserScan';
import { useProductToast } from './ui';
import type { AICall, Economics, EngineHealth, EnginePlatformStatus, Evaluation, Experiment, Finding, Implementation, OptimizationExecution, OptimizationPlan, Product, ScanResult } from './types';

export type InspectTarget =
  | { kind: 'finding'; id: string }
  | { kind: 'evaluation'; id: string }
  | { kind: 'experiment'; id: string }
  | { kind: 'implementation'; id: string }
  | { kind: 'execution'; id: string }
  | { kind: 'plan'; id: string }
  | null;

export type ZevState = 'idle' | 'thinking' | 'scanning' | 'experimenting' | 'verifying' | 'done';

interface ProductStore {
  engine: Engine;
  runtime: 'browser' | 'desktop';
  inspect: InspectTarget;
  setInspect: (target: InspectTarget) => void;
  health: EngineHealth | null;
  engineError: string;
  platformStatus: EnginePlatformStatus | null;
  refreshHealth: () => Promise<void>;
  products: Product[];
  productsLoading: boolean;
  selected: Product | null;
  selectProduct: (id: string | null) => void;
  scan: ScanResult | null;
  aiCalls: AICall[];
  findings: Finding[];
  economics: Economics | null;
  experiments: Experiment[];
  implementations: Implementation[];
  plans: OptimizationPlan[];
  executions: OptimizationExecution[];
  evaluations: Evaluation[];
  dataLoading: boolean;
  refreshProducts: () => Promise<void>;
  refreshProductData: () => Promise<void>;
  /** Browser: folder picker + local scan + upload. Desktop: local engine scans the folder. */
  connectRepository: (input?: { path?: string; name?: string }) => Promise<ScanResult | null>;
  runScan: () => Promise<ScanResult | null>;
  toggleMonitoring: () => Promise<void>;
  importTraceFile: () => Promise<void>;
  archiveProduct: (id: string) => Promise<void>;
  /** Re-read a file from the folder the user picked (browser) for patch preparation. */
  readRepositoryFile: (relPath: string) => Promise<string | null>;
  /** Browser: make sure the selected product's folder is available (asks the user to pick it again after a reload). */
  ensureRepository: () => Promise<PickedRepository | null>;
  pickedRepository: PickedRepository | null;
  zevState: ZevState;
  setZevState: (state: ZevState) => void;
  model: string;
  setModel: (model: string) => void;
}

const Ctx = createContext<ProductStore | null>(null);

export function useProduct() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProduct must be used within ProductProvider');
  return ctx;
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const { me, activeWorkspace } = useSession();
  const toast = useProductToast();
  const runtime: 'browser' | 'desktop' = isDesktop() ? 'desktop' : 'browser';
  const workspaceId = activeWorkspace?.id || null;
  const engine = useMemo<Engine>(() => (runtime === 'desktop' ? localEngine() : cloudEngine(workspaceId || '')), [runtime, workspaceId]);

  const [inspect, setInspect] = useState<InspectTarget>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [engineError, setEngineError] = useState('');
  const [platformStatus, setPlatformStatus] = useState<EnginePlatformStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('zevqora.selectedProduct');
    } catch {
      return null;
    }
  });
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [aiCalls, setAiCalls] = useState<AICall[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [economics, setEconomics] = useState<Economics | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [implementations, setImplementations] = useState<Implementation[]>([]);
  const [plans, setPlans] = useState<OptimizationPlan[]>([]);
  const [executions, setExecutions] = useState<OptimizationExecution[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [zevState, setZevState] = useState<ZevState>('idle');
  const [model, setModelState] = useState(() => {
    try {
      return localStorage.getItem('zevqora.agentModel') || 'openai/gpt-4o-mini';
    } catch {
      return 'openai/gpt-4o-mini';
    }
  });
  const picked = useRef<PickedRepository | null>(null);
  const [pickedRepository, setPickedRepository] = useState<PickedRepository | null>(null);

  const selected = useMemo(() => products.find((p) => p.id === selectedId) || null, [products, selectedId]);

  // Desktop: hand the account session to the local engine so it can use platform compute.
  useEffect(() => {
    if (runtime !== 'desktop' || !me) return;
    void syncLocalEngineSession(workspaceId, { id: me.user.id, email: me.user.email }, me.account?.plan || null).catch(() => undefined);
  }, [runtime, me, workspaceId]);

  const refreshHealth = useCallback(async () => {
    if (runtime === 'browser' && !workspaceId) return;
    try {
      const next = await engine.health();
      setHealth(next);
      setEngineError('');
      try {
        setPlatformStatus(await engine.platformStatus());
      } catch {
        setPlatformStatus(null);
      }
    } catch (error) {
      setHealth(null);
      setPlatformStatus(null);
      setEngineError(engineErrorMessage(error));
    }
  }, [engine, runtime, workspaceId]);

  useEffect(() => {
    void refreshHealth();
    const id = window.setInterval(() => void refreshHealth(), runtime === 'desktop' ? 10_000 : 60_000);
    return () => window.clearInterval(id);
  }, [refreshHealth, runtime]);

  const refreshProducts = useCallback(async () => {
    if (runtime === 'browser' && !workspaceId) return;
    setProductsLoading(true);
    try {
      const rows = await engine.products();
      setProducts(rows);
      setSelectedId((current) => (current && rows.some((r) => r.id === current) ? current : rows[0]?.id || null));
    } finally {
      setProductsLoading(false);
    }
  }, [engine, runtime, workspaceId]);

  useEffect(() => {
    void refreshProducts().catch((error) => setEngineError(engineErrorMessage(error)));
  }, [refreshProducts]);

  const selectProduct = useCallback((id: string | null) => {
    setSelectedId(id);
    try {
      if (id) localStorage.setItem('zevqora.selectedProduct', id);
      else localStorage.removeItem('zevqora.selectedProduct');
    } catch {
      /* ignore */
    }
    setInspect(null);
  }, []);

  const refreshProductData = useCallback(async () => {
    if (!selectedId) {
      setAiCalls([]);
      setFindings([]);
      setEconomics(null);
      setExperiments([]);
      setImplementations([]);
      setPlans([]);
      setExecutions([]);
      setEvaluations([]);
      return;
    }
    setDataLoading(true);
    try {
      const [calls, nextFindings, nextEconomics, nextExperiments, nextImplementations, nextPlans, nextExecutions, nextEvaluations] = await Promise.all([
        engine.aiCalls(selectedId),
        engine.findings(selectedId),
        engine.economics(selectedId),
        engine.experiments(selectedId),
        engine.implementations(selectedId),
        engine.plans(selectedId),
        engine.executions(selectedId),
        engine.evaluations(selectedId),
      ]);
      setAiCalls(calls);
      setFindings(nextFindings);
      setEconomics(nextEconomics);
      setExperiments(nextExperiments);
      setImplementations(nextImplementations);
      setPlans(nextPlans);
      setExecutions(nextExecutions);
      setEvaluations(nextEvaluations);
    } finally {
      setDataLoading(false);
    }
  }, [engine, selectedId]);

  useEffect(() => {
    setScan(null);
    void refreshProductData().catch(() => undefined);
  }, [refreshProductData]);

  const connectRepository = useCallback(
    async (input?: { path?: string; name?: string }) => {
      setZevState('scanning');
      try {
        let result: ScanResult;
        if (runtime === 'desktop') {
          const bridge = desktopBridge();
          const path = input?.path || (await bridge?.selectFolder()) || '';
          if (!path) {
            setZevState('idle');
            return null;
          }
          result = await engine.connect({ rootPath: path, name: input?.name });
        } else {
          const repo = await pickRepository();
          if (!repo) {
            setZevState('idle');
            return null;
          }
          picked.current = repo;
          setPickedRepository(repo);
          result = await engine.connect({ rootPath: repo.rootPath, name: input?.name || repo.name, upload: repo.upload });
        }
        setScan(result);
        await refreshProducts();
        selectProduct(result.product.id);
        setZevState('done');
        window.setTimeout(() => setZevState('idle'), 1200);
        return result;
      } catch (error) {
        setZevState('idle');
        throw error;
      }
    },
    [engine, runtime, refreshProducts, selectProduct],
  );

  const runScan = useCallback(async () => {
    if (!selected) return null;
    setZevState('scanning');
    try {
      let result: ScanResult;
      if (runtime === 'desktop') result = await engine.scan(selected.id);
      else {
        let repo = picked.current && picked.current.rootPath === selected.root_path ? picked.current : null;
        if (!repo) {
          repo = await pickRepository();
          if (!repo) {
            setZevState('idle');
            return null;
          }
          picked.current = repo;
          setPickedRepository(repo);
        }
        result = await engine.scan(selected.id, repo.upload);
      }
      setScan(result);
      await refreshProducts();
      await refreshProductData();
      setZevState('done');
      window.setTimeout(() => setZevState('idle'), 1200);
      toast({ tone: 'ok', title: `Scanned ${result.files_scanned} files`, description: `${result.ai_calls.length} AI call sites · ${result.findings.length} opportunities · ${result.skipped_sensitive_paths} sensitive paths skipped` });
      return result;
    } catch (error) {
      setZevState('idle');
      toast({ tone: 'err', title: 'Scan failed', description: engineErrorMessage(error) });
      throw error;
    }
  }, [engine, runtime, selected, refreshProducts, refreshProductData, toast]);

  const toggleMonitoring = useCallback(async () => {
    if (!selected) return;
    await engine.monitoring(selected.id, !selected.monitoring_enabled);
    await refreshProducts();
  }, [engine, selected, refreshProducts]);

  const importTraceFile = useCallback(async () => {
    if (!selected) return;
    const file = runtime === 'desktop' ? await desktopBridge()?.selectTraceFile() : await pickTraceFile();
    if (!file) return;
    if (!file.content) {
      toast({ tone: 'err', title: 'Refusing to import a secret-bearing file name', description: 'Choose an explicit JSON/JSONL trace export.' });
      return;
    }
    setZevState('verifying');
    try {
      const result = await engine.importTraces(selected.id, file.content);
      await refreshProductData();
      setZevState('done');
      window.setTimeout(() => setZevState('idle'), 1200);
      if (result.rejected) toast({ tone: 'err', title: `Imported ${result.imported}, rejected ${result.rejected}`, description: result.errors[0] || 'Some rows were invalid.' });
      else toast({ tone: 'ok', title: `Imported ${result.imported} execution traces` });
    } catch (error) {
      setZevState('idle');
      toast({ tone: 'err', title: 'Import failed', description: engineErrorMessage(error) });
    }
  }, [engine, runtime, selected, refreshProductData, toast]);

  const archiveProduct = useCallback(
    async (id: string) => {
      await engine.archiveProduct(id);
      await refreshProducts();
    },
    [engine, refreshProducts],
  );

  const readRepositoryFile = useCallback(async (relPath: string) => {
    if (picked.current) return picked.current.read(relPath);
    return null;
  }, []);

  const ensureRepository = useCallback(async () => {
    if (runtime === 'desktop') return null;
    if (picked.current && (!selected || picked.current.rootPath === selected.root_path)) return picked.current;
    const repo = await pickRepository();
    if (!repo) return null;
    picked.current = repo;
    setPickedRepository(repo);
    return repo;
  }, [runtime, selected]);

  const setModel = useCallback((value: string) => {
    setModelState(value);
    try {
      localStorage.setItem('zevqora.agentModel', value);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ProductStore>(
    () => ({ engine, runtime, inspect, setInspect, health, engineError, platformStatus, refreshHealth, products, productsLoading, selected, selectProduct, scan, aiCalls, findings, economics, experiments, implementations, plans, executions, evaluations, dataLoading, refreshProducts, refreshProductData, connectRepository, runScan, toggleMonitoring, importTraceFile, archiveProduct, readRepositoryFile, ensureRepository, pickedRepository, zevState, setZevState, model, setModel }),
    [engine, runtime, inspect, health, engineError, platformStatus, refreshHealth, products, productsLoading, selected, selectProduct, scan, aiCalls, findings, economics, experiments, implementations, plans, executions, evaluations, dataLoading, refreshProducts, refreshProductData, connectRepository, runScan, toggleMonitoring, importTraceFile, archiveProduct, readRepositoryFile, ensureRepository, pickedRepository, zevState, model, setModel],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
