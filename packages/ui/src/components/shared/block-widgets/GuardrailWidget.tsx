import { useCallback } from 'react';
import type { GuardrailBlock, GuardrailRule, GuardrailType } from '../../../lib/skill-block-types';

interface Props {
  data: GuardrailBlock;
  onChange: (data: GuardrailBlock) => void;
}

export function GuardrailWidget({ data, onChange }: Props) {
  const updateRule = useCallback(
    (index: number, field: keyof GuardrailRule, value: string) => {
      const rules = data.rules.map((r, i) =>
        i === index ? { ...r, [field]: value } : r,
      );
      onChange({ ...data, rules });
    },
    [data, onChange],
  );

  const toggleType = useCallback(
    (index: number) => {
      const rules = data.rules.map((r, i) =>
        i === index ? { ...r, type: (r.type === 'do' ? 'dont' : 'do') as GuardrailType } : r,
      );
      onChange({ ...data, rules });
    },
    [data, onChange],
  );

  const addRule = useCallback(
    (type: GuardrailType) => {
      onChange({
        ...data,
        rules: [...data.rules, { type, rule: '', reason: '' }],
      });
    },
    [data, onChange],
  );

  const removeRule = useCallback(
    (index: number) => {
      onChange({ ...data, rules: data.rules.filter((_, i) => i !== index) });
    },
    [data, onChange],
  );

  return (
    <div className="skill-widget-guardrail">
      <div className="skill-widget-header skill-widget-header-guardrail">
        <span className="skill-widget-icon">&#9888;</span>
        <span>Guardrails</span>
      </div>
      <div className="skill-widget-guardrail-rules">
        {data.rules.map((rule, i) => (
          <div key={i} className={`skill-widget-guardrail-rule skill-widget-guardrail-rule-${rule.type}`}>
            <button
              type="button"
              onClick={() => toggleType(i)}
              className={`skill-widget-guardrail-badge skill-widget-guardrail-badge-${rule.type}`}
              title="Toggle DO / DON'T"
            >
              {rule.type === 'do' ? 'DO' : "DON'T"}
            </button>
            <div className="skill-widget-guardrail-content">
              <input
                type="text"
                value={rule.rule}
                onChange={(e) => updateRule(i, 'rule', e.target.value)}
                placeholder={rule.type === 'do' ? 'Do this...' : "Don't do this..."}
                className="skill-widget-input skill-widget-guardrail-input"
              />
              <input
                type="text"
                value={rule.reason}
                onChange={(e) => updateRule(i, 'reason', e.target.value)}
                placeholder="Reason (optional)"
                className="skill-widget-input skill-widget-guardrail-reason"
              />
            </div>
            {data.rules.length > 1 && (
              <button
                type="button"
                onClick={() => removeRule(i)}
                className="skill-widget-remove"
                title="Remove rule"
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="skill-widget-guardrail-actions">
        <button type="button" onClick={() => addRule('do')} className="skill-widget-add skill-widget-add-do">
          + Add DO
        </button>
        <button type="button" onClick={() => addRule('dont')} className="skill-widget-add skill-widget-add-dont">
          + Add DON'T
        </button>
      </div>
    </div>
  );
}
