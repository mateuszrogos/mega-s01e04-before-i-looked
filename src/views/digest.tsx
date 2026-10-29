import type { DigestResult } from '../digest/types.js';

export function DigestPage({ digest }: { digest: DigestResult }) {
  return (
    <>
      <h1>digest</h1>
      {digest.missing ? (
        <p class="mute">file not found</p>
      ) : digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>owner</th>
                <th>runs</th>
                <th>retries</th>
                <th>last status</th>
                <th>first</th>
                <th>last</th>
                <th>last error</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => (
                <tr class={row.retries >= 3 || row.hasFailure ? 'warn' : ''}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                  <td>{row.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {digest.badLines > 0 && (
            <p class="mute" style="margin-top: 1rem; font-size: 0.875em;">
              {digest.badLines} bad line{digest.badLines === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}
    </>
  );
}
