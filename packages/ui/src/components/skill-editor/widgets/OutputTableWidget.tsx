import { useCallback } from 'react';
import type { OutputBlock, OutputFile } from '../../../lib/skill-block-types';

interface Props {
  data: OutputBlock;
  onChange: (data: OutputBlock) => void;
}

const FORMAT_OPTIONS = ['JSON', 'Markdown', 'Text', 'CSV', 'YAML', 'PDF', 'PNG'];

export function OutputTableWidget({ data, onChange }: Props) {
  const updateFile = useCallback(
    (index: number, field: keyof OutputFile, value: string) => {
      const files = data.files.map((f, i) =>
        i === index ? { ...f, [field]: value } : f,
      );
      onChange({ ...data, files });
    },
    [data, onChange],
  );

  const addRow = useCallback(() => {
    onChange({
      ...data,
      files: [...data.files, { name: '', format: 'JSON', phase: '', description: '' }],
    });
  }, [data, onChange]);

  const removeRow = useCallback(
    (index: number) => {
      onChange({ ...data, files: data.files.filter((_, i) => i !== index) });
    },
    [data, onChange],
  );

  return (
    <div className="skill-widget-table">
      <div className="skill-widget-header skill-widget-header-output">
        <span className="skill-widget-icon">&#8594;</span>
        <span>Outputs</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Format</th>
            <th>Phase</th>
            <th>Description</th>
            <th className="skill-widget-action-col" />
          </tr>
        </thead>
        <tbody>
          {data.files.map((file, i) => (
            <tr key={i}>
              <td>
                <input
                  type="text"
                  value={file.name}
                  onChange={(e) => updateFile(i, 'name', e.target.value)}
                  placeholder="filename.json"
                  className="skill-widget-input skill-widget-input-mono"
                />
              </td>
              <td>
                <select
                  value={file.format}
                  onChange={(e) => updateFile(i, 'format', e.target.value)}
                  className="skill-widget-select"
                >
                  {FORMAT_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="text"
                  value={file.phase}
                  onChange={(e) => updateFile(i, 'phase', e.target.value)}
                  placeholder="Phase 1"
                  className="skill-widget-input"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={file.description}
                  onChange={(e) => updateFile(i, 'description', e.target.value)}
                  placeholder="What this file contains"
                  className="skill-widget-input"
                />
              </td>
              <td className="skill-widget-action-col">
                {data.files.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="skill-widget-remove"
                    title="Remove row"
                  >
                    &times;
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={addRow} className="skill-widget-add">
        + Add Output
      </button>
    </div>
  );
}
