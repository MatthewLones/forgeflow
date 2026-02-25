import { useCallback } from 'react';
import type { InputBlock, InputFile } from '../../../lib/skill-block-types';

interface Props {
  data: InputBlock;
  onChange: (data: InputBlock) => void;
}

export function InputTableWidget({ data, onChange }: Props) {
  const updateFile = useCallback(
    (index: number, field: keyof InputFile, value: string | boolean) => {
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
      files: [...data.files, { name: '', format: '', required: true, description: '' }],
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
      <div className="skill-widget-header skill-widget-header-input">
        <span className="skill-widget-icon">&#8592;</span>
        <span>Inputs</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Format</th>
            <th>Required</th>
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
                  placeholder="Input name"
                  className="skill-widget-input"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={file.format}
                  onChange={(e) => updateFile(i, 'format', e.target.value)}
                  placeholder="PDF, PNG, JSON..."
                  className="skill-widget-input"
                />
              </td>
              <td>
                <label className="skill-widget-checkbox-label">
                  <input
                    type="checkbox"
                    checked={file.required}
                    onChange={(e) => updateFile(i, 'required', e.target.checked)}
                    className="skill-widget-checkbox"
                  />
                </label>
              </td>
              <td>
                <input
                  type="text"
                  value={file.description}
                  onChange={(e) => updateFile(i, 'description', e.target.value)}
                  placeholder="What this input provides"
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
        + Add Input
      </button>
    </div>
  );
}
