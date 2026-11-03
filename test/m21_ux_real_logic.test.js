const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function walkFiles(dir, list = []) {
  const absDir = path.join(ROOT, dir);
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rel, list);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      list.push(rel);
    }
  }
  return list;
}

describe('Milestone 21 — UX Real-Logic Audit and Fix', () => {
  it('1. Zero forbidden patterns (setTimeout, Math.random, empty onPress, TODO, FIXME, coming soon) in app/ and services/', () => {
    const files = [...walkFiles('app'), ...walkFiles('services')];
    const forbiddenRegex = /setTimeout|Math\.random|onPress=\{\(\)\s*=>\s*\{\s*\}\}|\bTODO\b|\bFIXME\b|coming soon/i;

    const hits = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (forbiddenRegex.test(line)) {
          hits.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(hits, [], `Found forbidden patterns:\n${hits.join('\n')}`);
  });

  it('2. Zero forbidden trust/placeholder words (verified, guaranteed, mock, fake, dummy, sample) in app/, services/, constants/', () => {
    const files = [
      ...walkFiles('app'),
      ...walkFiles('services'),
      ...walkFiles('constants'),
    ];
    const forbiddenWords = /\b(verified|guaranteed|mock|fake|dummy|sample)\b|searchFake/i;

    const hits = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (forbiddenWords.test(line)) {
          hits.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    assert.deepEqual(hits, [], `Found forbidden words:\n${hits.join('\n')}`);
  });

  it('3. Every screen in app/ that calls router.back() guards it with router.canGoBack()', () => {
    const appFiles = walkFiles('app');
    const unguardedFiles = [];

    for (const file of appFiles) {
      const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
      if (content.includes('router.back()') && !content.includes('router.canGoBack()')) {
        unguardedFiles.push(file);
      }
    }

    assert.deepEqual(
      unguardedFiles,
      [],
      `Screens calling router.back() without router.canGoBack(): ${unguardedFiles.join(', ')}`
    );
  });

  it('4. Realtime channels and caches are cleaned up on sign-out and mode switch', () => {
    const useAuthSrc = fs.readFileSync(path.join(ROOT, 'hooks/useAuth.tsx'), 'utf8');
    const modeSrc = fs.readFileSync(path.join(ROOT, 'app/settings/mode.tsx'), 'utf8');

    assert.ok(
      useAuthSrc.includes('supabase.removeAllChannels()'),
      'hooks/useAuth.tsx must call supabase.removeAllChannels() on sign out'
    );
    assert.ok(
      modeSrc.includes('supabase.removeAllChannels()'),
      'app/settings/mode.tsx must call supabase.removeAllChannels() on mode switch'
    );
  });

  it('5. constants/strings.ts defines strings.errors and mapSqlErrorToFriendlyMessage', () => {
    const stringsSrc = fs.readFileSync(path.join(ROOT, 'constants/strings.ts'), 'utf8');
    assert.ok(stringsSrc.includes('errors: {'), 'strings.errors must exist');
    assert.ok(
      stringsSrc.includes('export function mapSqlErrorToFriendlyMessage'),
      'mapSqlErrorToFriendlyMessage must be exported from constants/strings.ts'
    );
    assert.ok(stringsSrc.includes("code === '42501'"), 'Must map RLS 42501 error code');
    assert.ok(stringsSrc.includes("code === '23505'"), 'Must map duplicate 23505 error code');
  });

  it('6. Deliverable submit and review screens wire private submissions bucket upload and signed URLs', () => {
    const milestonesSvc = fs.readFileSync(path.join(ROOT, 'services/milestones.ts'), 'utf8');
    const submitSrc = fs.readFileSync(
      path.join(ROOT, 'app/agreements/[id]/milestones/[milestoneId]/submit.tsx'),
      'utf8'
    );
    const reviewSrc = fs.readFileSync(
      path.join(ROOT, 'app/agreements/[id]/milestones/[milestoneId]/review.tsx'),
      'utf8'
    );

    assert.ok(
      milestonesSvc.includes('pickAndUploadSubmissionFile'),
      'milestonesService must provide pickAndUploadSubmissionFile'
    );
    assert.ok(
      submitSrc.includes('milestonesService.pickAndUploadSubmissionFile'),
      'submit.tsx must wire milestonesService.pickAndUploadSubmissionFile'
    );
    assert.ok(
      reviewSrc.includes('milestonesService.createSignedUrl'),
      'review.tsx must resolve signed URLs via milestonesService.createSignedUrl'
    );
  });

  it('7. Payment report and agreement detail screens wire private receipts bucket upload and signed URLs', () => {
    const paymentsSvc = fs.readFileSync(path.join(ROOT, 'services/payments.ts'), 'utf8');
    const reportSrc = fs.readFileSync(
      path.join(ROOT, 'app/agreements/[id]/payments/report.tsx'),
      'utf8'
    );
    const agreementSrc = fs.readFileSync(path.join(ROOT, 'app/agreements/[id].tsx'), 'utf8');

    assert.ok(
      paymentsSvc.includes('pickAndUploadReceiptImage'),
      'paymentsService must provide pickAndUploadReceiptImage'
    );
    assert.ok(
      reportSrc.includes('paymentsService.pickAndUploadReceiptImage'),
      'payments/report.tsx must wire paymentsService.pickAndUploadReceiptImage'
    );
    assert.ok(
      agreementSrc.includes('paymentsService.createSignedReceiptUrl'),
      'agreements/[id].tsx must resolve signed receipt URLs via paymentsService.createSignedReceiptUrl'
    );
  });
});
