import { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import './styles.css';
import { ProductProvider, useProduct } from './store';
import { DialogsContext, type ProductDialogs } from './dialogs/context';
import { ConnectRepositoryDialog } from './dialogs/ConnectRepositoryDialog';
import { TestOpportunityDialog } from './dialogs/TestOpportunityDialog';
import { PrepareChangeDialog } from './dialogs/PrepareChangeDialog';
import { useProductToast } from './ui';
import type { Experiment, Finding } from './types';

function Dialogs({ children }: { children: React.ReactNode }) {
  const { findings, refreshProductData, setInspect } = useProduct();
  const navigate = useNavigate();
  const toast = useProductToast();
  const [connectOpen, setConnectOpen] = useState(false);
  const [testFinding, setTestFinding] = useState<Finding | null>(null);
  const [prepareExperiment, setPrepareExperiment] = useState<Experiment | null>(null);

  const openTest = useCallback(
    (finding: Finding | null) => {
      if (finding) setTestFinding(finding);
      else if (findings.length) setTestFinding(findings[0]);
      else toast({ tone: 'info', title: 'No opportunities to test yet', description: 'Scan the repository and import execution traces first.' });
    },
    [findings, toast],
  );

  const value = useMemo<ProductDialogs>(() => ({ openConnect: () => setConnectOpen(true), openTest, openPrepare: (experiment) => setPrepareExperiment(experiment) }), [openTest]);

  return (
    <DialogsContext.Provider value={value}>
      {children}
      <ConnectRepositoryDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      <TestOpportunityDialog
        finding={testFinding}
        onClose={() => {
          setTestFinding(null);
        }}
        onComplete={async (evaluation) => {
          await refreshProductData();
          setInspect({ kind: 'evaluation', id: evaluation.id });
          navigate('/app/experiments');
        }}
      />
      <PrepareChangeDialog
        experiment={prepareExperiment}
        onClose={() => setPrepareExperiment(null)}
        onComplete={async (implementation) => {
          await refreshProductData();
          setInspect({ kind: 'implementation', id: implementation.id });
          toast({ tone: 'ok', title: 'Change candidate prepared', description: implementation.branch_name });
          navigate('/app/changes');
        }}
      />
    </DialogsContext.Provider>
  );
}

/** Route layout for the product: one store, one set of dialogs, identical on web and desktop. */
export default function ProductLayout() {
  return (
    <ProductProvider>
      <Dialogs>
        <Outlet />
      </Dialogs>
    </ProductProvider>
  );
}
