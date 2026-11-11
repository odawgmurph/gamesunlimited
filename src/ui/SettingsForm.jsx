/**
 * Renders a game's settings schema. Supported field types:
 *   { key, label, type: 'number', min, max, step, default, suffix?, help? }
 *   { key, label, type: 'toggle', default, help? }
 *   { key, label, type: 'select', options: [{ value, label }], default, help? }
 * Optional `when: (values) => boolean` hides a field when irrelevant.
 */
export function SettingsForm({ schema, values, editable, onChange }) {
  return (
    <div class="settings">
      {schema
        .filter((f) => !f.when || f.when(values))
        .map((f) => {
          const v = values[f.key] ?? f.default;
          let input;
          if (f.type === 'toggle') {
            input = <input type="checkbox" name={f.key} checked={!!v} disabled={!editable} onChange={(e) => onChange({ [f.key]: e.currentTarget.checked })} />;
          } else if (f.type === 'select') {
            input = (
              <select name={f.key} value={v} disabled={!editable} onChange={(e) => onChange({ [f.key]: e.currentTarget.value })}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          } else {
            input = (
              <span class="num">
                <input
                  type="number"
                  name={f.key}
                  value={v}
                  min={f.min}
                  max={f.max}
                  step={f.step || 1}
                  disabled={!editable}
                  onChange={(e) => onChange({ [f.key]: Number(e.currentTarget.value) })}
                />
                {f.suffix && <span class="muted">{f.suffix}</span>}
              </span>
            );
          }
          return (
            <label key={f.key} class={`setting setting-${f.type}`} title={f.help || ''}>
              <span class="setting-label">
                {f.label}
                {f.help && <small>{f.help}</small>}
              </span>
              {input}
            </label>
          );
        })}
    </div>
  );
}
