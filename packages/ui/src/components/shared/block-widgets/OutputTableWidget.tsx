import { useState, useCallback, useRef, useEffect } from 'react';
import type { ArtifactFormat, ArtifactField } from '@forgeflow/types';
import type { OutputBlock, OutputFile } from '../../../lib/skill-block-types';

interface Props {
  data: OutputBlock;
  onChange: (data: OutputBlock) => void;
}

const FORMAT_OPTIONS: { value: ArtifactFormat; label: string }[] = [
  { value: 'json', label: 'Structured' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
  { value: 'csv', label: 'CSV' },
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Image' },
  { value: 'binary', label: 'Binary' },
];

export function OutputTableWidget({ data, onChange }: Props) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const updateFile = useCallback(
    (index: number, field: keyof OutputFile, value: string) => {
      const files = data.files.map((f, i) =>
        i === index ? { ...f, [field]: value } : f,
      );
      onChange({ ...data, files });
    },
    [data, onChange],
  );

  const updateFileFields = useCallback(
    (index: number, fields: ArtifactField[]) => {
      const files = data.files.map((f, i) =>
        i === index ? { ...f, fields } : f,
      );
      onChange({ ...data, files });
    },
    [data, onChange],
  );

  const addRow = useCallback(() => {
    onChange({
      ...data,
      files: [...data.files, { name: '', format: 'json', description: '' }],
    });
  }, [data, onChange]);

  const removeRow = useCallback(
    (index: number) => {
      onChange({ ...data, files: data.files.filter((_, i) => i !== index) });
      if (expandedRow === index) setExpandedRow(null);
    },
    [data, onChange, expandedRow],
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
            <th>Description</th>
            <th className="skill-widget-actions-col" />
          </tr>
        </thead>
        <tbody>
          {data.files.map((file, i) => (
            <OutputRow
              key={i}
              file={file}
              index={i}
              expanded={expandedRow === i}
              canRemove={data.files.length > 1}
              onUpdate={updateFile}
              onUpdateFields={updateFileFields}
              onRemove={removeRow}
              onToggleExpand={() => setExpandedRow(expandedRow === i ? null : i)}
            />
          ))}
        </tbody>
      </table>
      <button type="button" onClick={addRow} className="skill-widget-add">
        + Add Output
      </button>
    </div>
  );
}

interface OutputRowProps {
  file: OutputFile;
  index: number;
  expanded: boolean;
  canRemove: boolean;
  onUpdate: (index: number, field: keyof OutputFile, value: string) => void;
  onUpdateFields: (index: number, fields: ArtifactField[]) => void;
  onRemove: (index: number) => void;
  onToggleExpand: () => void;
}

function OutputRow({ file, index, expanded, canRemove, onUpdate, onUpdateFields, onRemove, onToggleExpand }: OutputRowProps) {
  const isJson = file.format === 'json';
  const fieldCount = file.fields?.length ?? 0;

  return (
    <>
      <tr>
        <td>
          <input
            type="text"
            value={file.name}
            onChange={(e) => onUpdate(index, 'name', e.target.value)}
            placeholder="filename.json"
            className="skill-widget-input skill-widget-input-mono"
          />
        </td>
        <td>
          <select
            value={file.format}
            onChange={(e) => onUpdate(index, 'format', e.target.value)}
            className="skill-widget-select"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </td>
        <td>
          <input
            type="text"
            value={file.description}
            onChange={(e) => onUpdate(index, 'description', e.target.value)}
            placeholder="What this file contains"
            className="skill-widget-input"
          />
        </td>
        <td className="skill-widget-actions-col">
          <div className="skill-widget-row-actions">
            {isJson && (
              <button
                type="button"
                onClick={onToggleExpand}
                className={`skill-widget-expand-btn ${expanded ? 'skill-widget-expand-btn-active' : ''}`}
                title={expanded ? 'Collapse fields' : 'Define schema fields'}
              >
                {expanded ? '▾' : '▸'}
                <span className="skill-widget-expand-label">Fields</span>
                {!expanded && fieldCount > 0 && <span className="skill-widget-field-count">{fieldCount}</span>}
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="skill-widget-remove skill-widget-remove-visible"
                title="Remove output"
              >
                &times;
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && isJson && (
        <tr>
          <td colSpan={4} className="skill-widget-fields-cell">
            <FieldsEditor
              fields={file.fields ?? []}
              onChange={(fields) => onUpdateFields(index, fields)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

interface FieldsEditorProps {
  fields: ArtifactField[];
  onChange: (fields: ArtifactField[]) => void;
}

function FieldsEditor({ fields, onChange }: FieldsEditorProps) {
  const addField = useCallback(() => {
    onChange([...fields, { key: '', type: 'string', description: '', required: true }]);
  }, [fields, onChange]);

  const updateField = useCallback(
    (index: number, updates: Partial<ArtifactField>) => {
      const next = fields.map((f, i) => (i === index ? { ...f, ...updates } : f));
      onChange(next);
    },
    [fields, onChange],
  );

  const removeField = useCallback(
    (index: number) => {
      onChange(fields.filter((_, i) => i !== index));
    },
    [fields, onChange],
  );

  const handleDescKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onChange([
          ...fields.slice(0, index + 1),
          { key: '', type: 'string', description: '', required: true },
          ...fields.slice(index + 1),
        ]);
      }
      // Shift+Enter: default textarea behavior (newline)
    },
    [fields, onChange],
  );

  return (
    <div className="skill-widget-fields-area">
      <div className="skill-widget-fields-header">
        <span>Fields</span>
        <button type="button" onClick={addField} className="skill-widget-fields-add">
          + Field
        </button>
      </div>
      {fields.length === 0 && (
        <div className="skill-widget-fields-empty">No fields defined — click + Field to add schema</div>
      )}
      {fields.map((field, i) => (
        <FieldRow
          key={i}
          field={field}
          index={i}
          onUpdate={updateField}
          onRemove={removeField}
          onDescKeyDown={handleDescKeyDown}
          isNew={field.key === '' && field.description === ''}
        />
      ))}
    </div>
  );
}

interface FieldRowProps {
  field: ArtifactField;
  index: number;
  onUpdate: (index: number, updates: Partial<ArtifactField>) => void;
  onRemove: (index: number) => void;
  onDescKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => void;
  isNew: boolean;
}

function FieldRow({ field, index, onUpdate, onRemove, onDescKeyDown, isNew }: FieldRowProps) {
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNew && keyRef.current) {
      keyRef.current.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="skill-widget-field-row">
      <input
        ref={keyRef}
        type="text"
        value={field.key}
        onChange={(e) => onUpdate(index, { key: e.target.value })}
        placeholder="key"
        className="skill-widget-input skill-widget-input-mono skill-widget-field-key"
      />
      <textarea
        value={field.description}
        onChange={(e) => onUpdate(index, { description: e.target.value })}
        onKeyDown={(e) => onDescKeyDown(e, index)}
        placeholder="description (Enter = new field, Shift+Enter = newline)"
        className="skill-widget-input skill-widget-field-desc"
        rows={1}
      />
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="skill-widget-remove skill-widget-remove-visible"
        title="Remove field"
      >
        &times;
      </button>
    </div>
  );
}
