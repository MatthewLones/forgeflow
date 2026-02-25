import { useCallback, useState } from 'react';
import type { DecisionBlock, DecisionRow } from '../../../lib/skill-block-types';

interface Props {
  data: DecisionBlock;
  onChange: (data: DecisionBlock) => void;
}

export function DecisionTreeWidget({ data, onChange }: Props) {
  const updateTitle = useCallback(
    (title: string) => {
      onChange({ ...data, title });
    },
    [data, onChange],
  );

  const updateRow = useCallback(
    (index: number, field: keyof DecisionRow, value: string | string[]) => {
      const rows = data.rows.map((r, i) =>
        i === index ? { ...r, [field]: value } : r,
      );
      onChange({ ...data, rows });
    },
    [data, onChange],
  );

  const addRow = useCallback(() => {
    onChange({
      ...data,
      rows: [...data.rows, { condition: '', action: '', references: [] }],
    });
  }, [data, onChange]);

  const removeRow = useCallback(
    (index: number) => {
      onChange({ ...data, rows: data.rows.filter((_, i) => i !== index) });
    },
    [data, onChange],
  );

  return (
    <div className="skill-widget-decision">
      <div className="skill-widget-header skill-widget-header-decision">
        <span className="skill-widget-icon">&#9670;</span>
        <input
          type="text"
          value={data.title}
          onChange={(e) => updateTitle(e.target.value)}
          placeholder="Decision title"
          className="skill-widget-title-input"
        />
      </div>
      <div className="skill-widget-decision-rows">
        {data.rows.map((row, i) => (
          <DecisionRowEditor
            key={i}
            row={row}
            index={i}
            canRemove={data.rows.length > 1}
            onUpdate={updateRow}
            onRemove={removeRow}
          />
        ))}
      </div>
      <button type="button" onClick={addRow} className="skill-widget-add">
        + Add Condition
      </button>
    </div>
  );
}

function DecisionRowEditor({
  row,
  index,
  canRemove,
  onUpdate,
  onRemove,
}: {
  row: DecisionRow;
  index: number;
  canRemove: boolean;
  onUpdate: (index: number, field: keyof DecisionRow, value: string | string[]) => void;
  onRemove: (index: number) => void;
}) {
  const [refInput, setRefInput] = useState('');

  const addReference = useCallback(() => {
    if (!refInput.trim()) return;
    onUpdate(index, 'references', [...row.references, refInput.trim()]);
    setRefInput('');
  }, [index, row.references, refInput, onUpdate]);

  const removeReference = useCallback(
    (refIndex: number) => {
      onUpdate(index, 'references', row.references.filter((_, i) => i !== refIndex));
    },
    [index, row.references, onUpdate],
  );

  return (
    <div className="skill-widget-decision-row">
      <div className="skill-widget-decision-condition">
        <span className="skill-widget-decision-label">IF</span>
        <input
          type="text"
          value={row.condition}
          onChange={(e) => onUpdate(index, 'condition', e.target.value)}
          placeholder="Condition..."
          className="skill-widget-input"
        />
      </div>
      <div className="skill-widget-decision-arrow">&rarr;</div>
      <div className="skill-widget-decision-action">
        <span className="skill-widget-decision-label">THEN</span>
        <input
          type="text"
          value={row.action}
          onChange={(e) => onUpdate(index, 'action', e.target.value)}
          placeholder="Action to take..."
          className="skill-widget-input"
        />
      </div>
      {row.references.length > 0 && (
        <div className="skill-widget-decision-refs">
          {row.references.map((ref, ri) => (
            <span key={ri} className="skill-widget-ref-pill">
              {ref}
              <button
                type="button"
                onClick={() => removeReference(ri)}
                className="skill-widget-ref-pill-remove"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="skill-widget-decision-ref-add">
        <input
          type="text"
          value={refInput}
          onChange={(e) => setRefInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addReference()}
          placeholder="reference.md"
          className="skill-widget-input skill-widget-input-small"
        />
        <button type="button" onClick={addReference} className="skill-widget-ref-add-btn">
          +
        </button>
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="skill-widget-remove skill-widget-decision-remove"
          title="Remove condition"
        >
          &times;
        </button>
      )}
    </div>
  );
}
