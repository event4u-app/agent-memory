<?php

/**
 * MemoryService — Laravel-flavoured wrapper around the agent-memory CLI.
 *
 * Lives in App\Services. Injected into Actions, Jobs, and Commands that
 * need to read or write memory. The wrapper shells out to the sidecar via
 * `docker compose exec`, so there is zero Composer dependency on
 * @event4u/agent-memory — the sidecar owns the code, this class owns the
 * integration boundary.
 *
 * Usage (bind in AppServiceProvider::register):
 *
 *     $this->app->singleton(MemoryService::class, fn () => new MemoryService(
 *         composeFile: base_path('docker-compose.yml'),
 *         repository:  config('app.name'),
 *     ));
 *
 * Then inject wherever needed:
 *
 *     public function __construct(private MemoryService $memory) {}
 *     $health = $this->memory->health();
 *     $this->memory->ingest('bug_pattern', 'N+1 on Invoice::items', ...);
 *     $hits = $this->memory->retrieve('invoice calculation');
 */

declare(strict_types=1);

namespace App\Services;

use RuntimeException;
use Symfony\Component\Process\Process;

final class MemoryService
{
    public function __construct(
        private readonly string $composeFile = 'docker-compose.yml',
        private readonly string $service = 'agent-memory',
        private readonly string $repository = 'my-laravel-app',
        private readonly int $timeoutSeconds = 30,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function health(): array
    {
        return $this->run(['health']);
    }

    /**
     * @return array<string, mixed>
     */
    public function ingest(string $type, string $title, string $summary): array
    {
        return $this->run([
            'ingest',
            '--type', $type,
            '--title', $title,
            '--summary', $summary,
            '--repository', $this->repository,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    public function retrieve(string $query, int $limit = 5): array
    {
        return $this->run([
            'retrieve', $query,
            '--limit', (string) $limit,
        ]);
    }

    /**
     * @param list<string> $args
     * @return array<string, mixed>
     */
    private function run(array $args): array
    {
        $process = new Process([
            'docker', 'compose',
            '-f', $this->composeFile,
            'exec', '-T', $this->service,
            'memory', ...$args,
        ]);
        $process->setTimeout($this->timeoutSeconds);
        $process->mustRun();

        $decoded = json_decode($process->getOutput(), true);
        if (!is_array($decoded)) {
            throw new RuntimeException(sprintf(
                "memory %s returned non-JSON: %s",
                implode(' ', $args),
                $process->getOutput(),
            ));
        }

        return $decoded;
    }
}
