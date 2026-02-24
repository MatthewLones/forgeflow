import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Docker from 'dockerode';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_IMAGE_NAME = 'forgeflow-sandbox';
export const DEFAULT_IMAGE_TAG = 'latest';

/** Full image reference: forgeflow-sandbox:latest */
export function getImageRef(imageName?: string): string {
  return `${imageName ?? DEFAULT_IMAGE_NAME}:${DEFAULT_IMAGE_TAG}`;
}

/** Path to the docker/ directory containing the Dockerfile */
export function getDockerContextPath(): string {
  // In dev: packages/engine/src/../docker → packages/engine/docker
  // In dist: packages/engine/dist/../docker → packages/engine/docker
  return join(__dirname, '..', 'docker');
}

/**
 * Check if the sandbox Docker image exists locally.
 */
export async function imageExists(
  docker: Docker,
  imageName?: string,
): Promise<boolean> {
  const ref = getImageRef(imageName);
  const images = await docker.listImages({
    filters: { reference: [ref] },
  });
  return images.length > 0;
}

/**
 * Build the sandbox Docker image from the docker/ directory.
 */
export async function buildImage(
  docker: Docker,
  imageName?: string,
): Promise<void> {
  const contextPath = getDockerContextPath();
  const ref = getImageRef(imageName);

  const stream = await docker.buildImage(
    { context: contextPath, src: ['Dockerfile', 'entrypoint.mjs'] },
    { t: ref },
  );

  // Wait for build to complete by consuming the stream
  await new Promise<void>((resolve, reject) => {
    stream.on('data', () => {});
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}
