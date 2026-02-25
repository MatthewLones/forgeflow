import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../context/ProjectStore';
import { ProjectCard } from '../components/dashboard/ProjectCard';
import { CreateProjectDialog } from '../components/dashboard/CreateProjectDialog';

export function DashboardPage() {
  const { projects, loading, error, createProject, deleteProject } = useProjectStore();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleCreate = useCallback(
    async (name: string, description: string) => {
      const id = await createProject(name, description);
      navigate(`/workspace/${id}`);
    },
    [createProject, navigate],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteProject(id);
    },
    [deleteProject],
  );

  return (
    <div className="min-h-screen bg-[var(--color-canvas-bg)]">
      {/* Top bar */}
      <header className="h-14 px-6 flex items-center border-b border-[var(--color-border)] bg-white">
        <span className="text-base font-bold text-[var(--color-node-agent)]">ForgeFlow</span>
        <span className="text-xs text-[var(--color-text-muted)] ml-2">v0.1.0</span>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Error banner */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}. Make sure the ForgeFlow server is running on port 3001.
          </div>
        )}

        {/* Projects section */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Projects</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {loading ? 'Loading...' : `${projects.length} flow${projects.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              disabled={loading}
              className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--color-node-agent)] text-white hover:bg-[var(--color-node-agent)]/90 transition-colors disabled:opacity-50"
            >
              + New Project
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                <div className="w-4 h-4 border-2 border-[var(--color-node-agent)] border-t-transparent rounded-full animate-spin" />
                Loading projects...
              </div>
            </div>
          ) : projects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 rounded-xl border-2 border-dashed border-[var(--color-border)]">
              <div className="text-sm text-[var(--color-text-muted)] mb-3">
                No projects yet
              </div>
              <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--color-node-agent)] text-white hover:bg-[var(--color-node-agent)]/90 transition-colors"
              >
                Create your first flow
              </button>
            </div>
          )}
        </section>
      </main>

      <CreateProjectDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
