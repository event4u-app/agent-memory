<?php
/**
 * php-demo.php — Ingest + retrieve a memory entry via the CLI.
 *
 * Runs inside the `app` container of this example compose stack.
 * Assumes the `agent-memory` sidecar is healthy.
 *
 * Laravel integration: lift this into App\Actions\CallMemory with the
 * same Process usage and inject it where needed.
 */

declare(strict_types=1);

// Symfony Process is in laravel/framework; for this standalone demo we
// shell out with raw PHP for zero composer setup.

$compose = 'docker compose exec -T agent-memory memory';
$repo    = getenv('AGENT_MEMORY_REPOSITORY') ?: 'my-laravel-app';

function runCli(string $cmd): array
{
    exec($cmd . ' 2>&1', $lines, $code);
    $json = json_decode(implode("\n", $lines), true);
    return ['code' => $code, 'json' => $json, 'raw' => $lines];
}

echo "=== 1. Health check ===\n";
$health = runCli("$compose health");
echo "  status: {$health['json']['status']} | features: "
    . count($health['json']['features']) . "\n\n";

echo "=== 2. Ingest a memory ===\n";
$ingestCmd = sprintf(
    '%s ingest --type architecture_decision --title %s --summary %s --repository %s',
    $compose,
    escapeshellarg('Use jobs for email sending'),
    escapeshellarg('Never send email synchronously in request scope.'),
    escapeshellarg($repo),
);
$ingest = runCli($ingestCmd);
echo "  created: {$ingest['json']['id']} (status={$ingest['json']['status']})\n\n";

echo "=== 3. Retrieve the memory back ===\n";
$retrieveCmd = sprintf(
    '%s retrieve %s --limit 3 --low-trust',
    $compose,
    escapeshellarg('sending email'),
);
$retrieve = runCli($retrieveCmd);
$count = count($retrieve['json']['entries'] ?? []);
echo "  matches: $count\n";
if ($count > 0) {
    echo "  first title: " . $retrieve['json']['entries'][0]['title'] . "\n";
}
