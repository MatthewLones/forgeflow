import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProjectStoreProvider } from './context/ProjectStore';
import { DashboardPage } from './pages/DashboardPage';

const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
);

function Loading() {
  return (
    <div className="h-screen flex items-center justify-center text-sm text-[var(--color-text-muted)]">
      Loading...
    </div>
  );
}

export function App() {
  return (
    <ProjectStoreProvider>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/workspace/:id"
          element={
            <Suspense fallback={<Loading />}>
              <WorkspacePage />
            </Suspense>
          }
        />
        {/* Legacy routes redirect to workspace */}
        <Route path="/design/:id" element={<Navigate to="/workspace/contract_review" replace />} />
        <Route path="/skills/:id" element={<Navigate to="/workspace/contract_review" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProjectStoreProvider>
  );
}
