import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../context/ProjectStore';
import { ProjectCard } from '../components/dashboard/ProjectCard';
import { SkillCard } from '../components/dashboard/SkillCard';
import { CreateProjectDialog } from '../components/dashboard/CreateProjectDialog';

export function DashboardPage() {
  const { projects, skills, createProject, deleteProject } = useProjectStore();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleCreate = useCallback(
    (name: string, description: string) => {
      const id = createProject(name, description);
      navigate(`/design/${id}`);
    },
    [createProject, navigate],
  );

  return (
    <div className="min-h-screen bg-[var(--color-canvas-bg)]">
      {/* Top bar */}
      <header className="h-14 px-6 flex items-center border-b border-[var(--color-border)] bg-white">
        <span className="text-base font-bold text-[var(--color-node-agent)]">ForgeFlow</span>
        <span className="text-xs text-[var(--color-text-muted)] ml-2">v0.1.0</span>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Projects section */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Projects</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {projects.length} flow{projects.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="text-xs font-medium px-4 py-2 rounded-lg bg-[var(--color-node-agent)] text-white hover:bg-[var(--color-node-agent)]/90 transition-colors"
            >
              + New Project
            </button>
          </div>

          {projects.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onDelete={deleteProject}
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

        {/* Skills section */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Skills</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {skills.length} skill{skills.length !== 1 ? 's' : ''} available
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {skills.map((skill) => (
              <SkillCard key={skill.name} skill={skill} />
            ))}
          </div>
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
