import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/lib/session";
import {
  cloudEngine,
  localEngine,
  syncLocalEngineSession,
  engineErrorMessage,
  type Engine,
} from "./engine";
import { desktopBridge, isDesktop } from "./bridge";
import { pickTraceFile, type PickedRepository } from "./browserScan";
import { useProductToast } from "./ui";
import { isWorkloadProduct } from "./types";
import type {
  AICall,
  Economics,
  EngineHealth,
  EnginePlatformStatus,
  Evaluation,
  Experiment,
  Finding,
  Implementation,
  OptimizationExecution,
  OptimizationPlan,
  Product,
  ScanResult,
} from "./types";

export type InspectTarget =
  | { kind: "finding"; id: string }
  | { kind: "evaluation"; id: string }
  | { kind: "experiment"; id: string }
  | { kind: "implementation"; id: string }
  | { kind: "execution"; id: string }
  | { kind: "plan"; id: string }
  | null;

export type ZevState =
  "idle" | "thinking" | "scanning" | "experimenting" | "verifying" | "done";

interface ProductStore {
  engine: Engine;
  runtime: "browser" | "desktop";
  /** False for workspace viewers: they can inspect evidence but not scan, import, test or prepare changes. */
  canEdit: boolean;
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
  /** Set when the selected project's evidence failed to load; views must not read as empty. */
  dataError: string;
  refreshProducts: () => Promise<void>;
  refreshProductData: () => Promise<void>;
  /** Browser: folder picker + local scan + upload. Desktop: local engine scans the folder. */
  connectRepository: (input?: {
    path?: string;
    name?: string;
    source?: "github" | "server";
  }) => Promise<ScanResult | null>;
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
  if (!ctx) throw new Error("useProduct must be used within ProductProvider");
  return ctx;
}

/** Make a product the selection for its workspace before the product views mount (onboarding). */
export function rememberSelectedProduct(
  workspaceId: string,
  productId: string,
) {
  try {
    localStorage.setItem(`zevqora.selectedProduct:${workspaceId}`, productId);
  } catch {
    /* storage unavailable: the first product is selected by default */
  }
}

function readSelection(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const { me, activeWorkspace } = useSession();
  const toast = useProductToast();
  const runtime: "browser" | "desktop" = isDesktop() ? "desktop" : "browser";
  const workspaceId = activeWorkspace?.id || null;
  const canEdit =
    runtime === "desktop" ||
    (activeWorkspace ? activeWorkspace.role !== "viewer" : false);
  const engine = useMemo<Engine>(
    () =>
      runtime === "desktop" ? localEngine() : cloudEngine(workspaceId || ""),
    [runtime, workspaceId],
  );

  const [inspect, setInspect] = useState<InspectTarget>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [engineError, setEngineError] = useState("");
  const [platformStatus, setPlatformStatus] =
    useState<EnginePlatformStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  // The selection is remembered per workspace so switching workspaces never
  // carries another workspace's product id along.
  const selectionKey = `zevqora.selectedProduct:${workspaceId || "none"}`;
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    readSelection(selectionKey),
  );
  useEffect(() => {
    setSelectedId(readSelection(selectionKey));
  }, [selectionKey]);
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
  const [dataError, setDataError] = useState("");
  const [zevState, setZevState] = useState<ZevState>("idle");
  const [model, setModelState] = useState(() => {
    try {
      return localStorage.getItem("zevqora.agentModel") || "openai/gpt-4o-mini";
    } catch {
      return "openai/gpt-4o-mini";
    }
  });
  const pickedRepository: PickedRepository | null = null;

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) || null,
    [products, selectedId],
  );

  // Desktop: hand the account session to the local engine so it can use platform compute.
  useEffect(() => {
    if (runtime !== "desktop" || !me) return;
    void syncLocalEngineSession(
      workspaceId,
      { id: me.user.id, email: me.user.email },
      me.account?.plan || null,
    ).catch(() => undefined);
  }, [runtime, me, workspaceId]);

  const refreshHealth = useCallback(async () => {
    if (runtime === "browser" && !workspaceId) return;
    try {
      const next = await engine.health();
      setHealth(next);
      setEngineError("");
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
    const id = window.setInterval(
      () => void refreshHealth(),
      runtime === "desktop" ? 10_000 : 60_000,
    );
    return () => window.clearInterval(id);
  }, [refreshHealth, runtime]);

  const refreshProducts = useCallback(async () => {
    if (runtime === "browser" && !workspaceId) return;
    setProductsLoading(true);
    try {
      const rows = await engine.products();
      setProducts(rows);
      setSelectedId((current) =>
        current && rows.some((r) => r.id === current)
          ? current
          : rows[0]?.id || null,
      );
    } finally {
      setProductsLoading(false);
    }
  }, [engine, runtime, workspaceId]);

  useEffect(() => {
    void refreshProducts().catch((error) =>
      setEngineError(engineErrorMessage(error)),
    );
  }, [refreshProducts]);

  const selectProduct = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      try {
        if (id) localStorage.setItem(selectionKey, id);
        else localStorage.removeItem(selectionKey);
      } catch {
        /* ignore */
      }
      setInspect(null);
    },
    [selectionKey],
  );

  const refreshProductData = useCallback(async () => {
    if (!selectedId) {
      setDataError("");
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
      const [
        calls,
        nextFindings,
        nextEconomics,
        nextExperiments,
        nextImplementations,
        nextPlans,
        nextExecutions,
        nextEvaluations,
      ] = await Promise.all([
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
      setDataError("");
    } catch (error) {
      setDataError(engineErrorMessage(error));
      throw error;
    } finally {
      setDataLoading(false);
    }
  }, [engine, selectedId]);

  useEffect(() => {
    setScan(null);
    void refreshProductData().catch(() => undefined);
  }, [refreshProductData]);

  const viewOnly = useCallback(() => {
    if (canEdit) return false;
    toast({
      tone: "err",
      title: "View only",
      description:
        "Viewers can inspect evidence but not change it. Ask a workspace admin for a member role.",
    });
    return true;
  }, [canEdit, toast]);

  const connectRepository = useCallback(
    async (input?: {
      path?: string;
      name?: string;
      source?: "github" | "server";
    }) => {
      if (viewOnly()) return null;
      setZevState("scanning");
      try {
        let result: ScanResult;
        if (input?.source === "server") {
          const product = await engine.createWorkload({
            name: input.name || "Server workload",
          });
          result = {
            product,
            files_scanned: 0,
            ai_calls: [],
            findings: [],
            detected_stack: [],
            skipped_sensitive_paths: 0,
          };
        } else if (input?.source === "github") {
          if (!activeWorkspace)
            throw new Error("Select a workspace before connecting GitHub.");
          // Remote repositories always use the authenticated cloud engine, including desktop.
          result = await cloudEngine(activeWorkspace.id).connect({
            rootPath: input.path || "",
            name: input.name,
          });
        } else if (runtime === "desktop") {
          const bridge = desktopBridge();
          const path = input?.path || (await bridge?.selectFolder()) || "";
          if (!path) {
            setZevState("idle");
            return null;
          }
          result = await engine.connect({ rootPath: path, name: input?.name });
        } else {
          throw new Error(
            "Enter your GitHub repository URL or connect a server from the connection dialog.",
          );
        }
        setScan(result);
        await refreshProducts();
        selectProduct(result.product.id);
        setZevState("done");
        window.setTimeout(() => setZevState("idle"), 1200);
        return result;
      } catch (error) {
        setZevState("idle");
        throw error;
      }
    },
    [
      engine,
      runtime,
      activeWorkspace,
      refreshProducts,
      selectProduct,
      viewOnly,
    ],
  );

  const runScan = useCallback(async () => {
    if (!selected || viewOnly()) return null;
    if (isWorkloadProduct(selected)) {
      toast({
        tone: "err",
        title: "No repository to scan",
        description:
          "This project is a workload: its evidence is imported traces. Connect a repository as a separate project to scan code.",
      });
      return null;
    }
    setZevState("scanning");
    try {
      let result: ScanResult;
      if (selected.root_path.startsWith("https://github.com/"))
        result = await cloudEngine(activeWorkspace!.id).scan(selected.id);
      else if (runtime === "desktop") result = await engine.scan(selected.id);
      else {
        throw new Error(
          "This older project uses a local folder. Connect its GitHub URL to scan it in the cloud.",
        );
      }
      setScan(result);
      await refreshProducts();
      await refreshProductData();
      setZevState("done");
      window.setTimeout(() => setZevState("idle"), 1200);
      toast({
        tone: "ok",
        title: `Scanned ${result.files_scanned} files`,
        description: `${result.ai_calls.length} AI call sites · ${result.findings.length} opportunities · ${result.skipped_sensitive_paths} sensitive paths skipped`,
      });
      return result;
    } catch (error) {
      setZevState("idle");
      toast({
        tone: "err",
        title: "Scan failed",
        description: engineErrorMessage(error),
      });
      throw error;
    }
  }, [
    engine,
    runtime,
    selected,
    activeWorkspace,
    refreshProducts,
    refreshProductData,
    toast,
    viewOnly,
  ]);

  const toggleMonitoring = useCallback(async () => {
    if (!selected || viewOnly()) return;
    await engine.monitoring(selected.id, !selected.monitoring_enabled);
    await refreshProducts();
  }, [engine, selected, refreshProducts, viewOnly]);

  const importTraceFile = useCallback(async () => {
    if (!selected || viewOnly()) return;
    const file =
      runtime === "desktop"
        ? await desktopBridge()?.selectTraceFile()
        : await pickTraceFile();
    if (!file) return;
    if (!file.content) {
      toast({
        tone: "err",
        title: "Refusing to import a secret-bearing file name",
        description: "Choose an explicit JSON/JSONL trace export.",
      });
      return;
    }
    setZevState("verifying");
    try {
      const result = await engine.importTraces(selected.id, file.content);
      await refreshProductData();
      setZevState("done");
      window.setTimeout(() => setZevState("idle"), 1200);
      if (result.rejected)
        toast({
          tone: "err",
          title: `Imported ${result.imported}, rejected ${result.rejected}`,
          description: result.errors[0] || "Some rows were invalid.",
        });
      else
        toast({
          tone: "ok",
          title: `Imported ${result.imported} execution traces`,
        });
    } catch (error) {
      setZevState("idle");
      toast({
        tone: "err",
        title: "Import failed",
        description: engineErrorMessage(error),
      });
    }
  }, [engine, runtime, selected, refreshProductData, toast, viewOnly]);

  const archiveProduct = useCallback(
    async (id: string) => {
      await engine.archiveProduct(id);
      await refreshProducts();
    },
    [engine, refreshProducts],
  );

  const readRepositoryFile = useCallback(
    async (relPath: string) => {
      if (
        selected?.root_path.startsWith("https://github.com/") &&
        activeWorkspace
      )
        return cloudEngine(activeWorkspace.id).readSource(selected.id, relPath);
      return null;
    },
    [selected, activeWorkspace],
  );

  const ensureRepository = useCallback(async () => {
    if (runtime === "desktop") return null;
    if (
      selected?.root_path.startsWith("https://github.com/") &&
      activeWorkspace
    ) {
      return {
        name: selected.name,
        rootPath: selected.root_path,
        fileCount: selected.files_scanned || 0,
        upload: {
          files_scanned: 0,
          ai_calls: [],
          findings: [],
          detected_stack: [],
          skipped_sensitive_paths: 0,
        },
        read: (path: string) =>
          cloudEngine(activeWorkspace.id).readSource(selected.id, path),
      };
    }
    throw new Error(
      "Connect a GitHub repository to prepare changes in the cloud.",
    );
  }, [runtime, selected, activeWorkspace]);

  const setModel = useCallback((value: string) => {
    setModelState(value);
    try {
      localStorage.setItem("zevqora.agentModel", value);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ProductStore>(
    () => ({
      engine,
      runtime,
      canEdit,
      inspect,
      setInspect,
      health,
      engineError,
      platformStatus,
      refreshHealth,
      products,
      productsLoading,
      selected,
      selectProduct,
      scan,
      aiCalls,
      findings,
      economics,
      experiments,
      implementations,
      plans,
      executions,
      evaluations,
      dataLoading,
      dataError,
      refreshProducts,
      refreshProductData,
      connectRepository,
      runScan,
      toggleMonitoring,
      importTraceFile,
      archiveProduct,
      readRepositoryFile,
      ensureRepository,
      pickedRepository,
      zevState,
      setZevState,
      model,
      setModel,
    }),
    [
      engine,
      runtime,
      canEdit,
      inspect,
      health,
      engineError,
      platformStatus,
      refreshHealth,
      products,
      productsLoading,
      selected,
      selectProduct,
      scan,
      aiCalls,
      findings,
      economics,
      experiments,
      implementations,
      plans,
      executions,
      evaluations,
      dataLoading,
      dataError,
      refreshProducts,
      refreshProductData,
      connectRepository,
      runScan,
      toggleMonitoring,
      importTraceFile,
      archiveProduct,
      readRepositoryFile,
      ensureRepository,
      pickedRepository,
      zevState,
      model,
      setModel,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
