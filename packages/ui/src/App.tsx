import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
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

/** Redirect /design/:id → /workspace/:id (preserving the actual param) */
function DesignRedirect() {
  const { id } = useParams();
  return <Navigate to={`/workspace/${id}`} replace />;
}

/** Redirect /skills/:id → /workspace/:id with skill query param */
function SkillRedirect() {
  const { id } = useParams();
  return <Navigate to={`/workspace/${id}`} replace />;
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
        {/* Legacy routes redirect to workspace with actual :id param */}
        <Route path="/design/:id" element={<DesignRedirect />} />
        <Route path="/skills/:id" element={<SkillRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProjectStoreProvider>
  );
}
