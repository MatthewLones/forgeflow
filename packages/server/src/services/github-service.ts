import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { Octokit } from '@octokit/rest';
import type { GitHubConnection, GitHubRepo } from '@forgeflow/types';

const LOG_PREFIX = '[GitHubService]';
function log(...args: unknown[]) { console.log(LOG_PREFIX, ...args); }

const TOKEN_PATH = join(homedir(), '.forgeflow', 'github-token.json');
const OAUTH_SCOPE = 'repo,user:email';

interface StoredToken {
  accessToken: string;
  username: string;
  avatarUrl: string;
}

export class GitHubService {
  private clientId: string;
  private clientSecret: string;
  private cachedToken: StoredToken | null = null;

  constructor() {
    this.clientId = process.env.GITHUB_CLIENT_ID ?? '';
    this.clientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';
  }

  private get configured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  /** Load token from disk or cache */
  private async loadToken(): Promise<StoredToken | null> {
    if (this.cachedToken) return this.cachedToken;

    if (!existsSync(TOKEN_PATH)) return null;

    try {
      const data = JSON.parse(await readFile(TOKEN_PATH, 'utf-8'));
      this.cachedToken = data;
      return data;
    } catch {
      return null;
    }
  }

  /** Save token to disk */
  private async saveToken(token: StoredToken): Promise<void> {
    await mkdir(join(homedir(), '.forgeflow'), { recursive: true });
    await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2));
    this.cachedToken = token;
  }

  /** Get an Octokit instance with the stored token */
  private async getOctokit(): Promise<Octokit> {
    const token = await this.loadToken();
    if (!token) throw new Error('Not connected to GitHub');
    return new Octokit({ auth: token.accessToken });
  }

  /** Build the GitHub OAuth authorization URL */
  getAuthUrl(callbackUrl: string): string {
    if (!this.configured) {
      throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in .env');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: callbackUrl,
      scope: OAUTH_SCOPE,
    });

    return `https://github.com/login/oauth/authorize?${params}`;
  }

  /** Exchange OAuth code for access token, fetch user info, persist */
  async handleCallback(code: string): Promise<GitHubConnection> {
    if (!this.configured) {
      throw new Error('GitHub OAuth not configured');
    }

    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (tokenData.error) {
      throw new Error(`GitHub OAuth error: ${tokenData.error_description || tokenData.error}`);
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('No access token received');

    // Fetch user info
    const octokit = new Octokit({ auth: accessToken });
    const { data: user } = await octokit.users.getAuthenticated();

    const stored: StoredToken = {
      accessToken,
      username: user.login,
      avatarUrl: user.avatar_url,
    };

    await this.saveToken(stored);
    log(`Connected to GitHub as ${user.login}`);

    return {
      connected: true,
      username: user.login,
      avatarUrl: user.avatar_url,
    };
  }

  /** Get current connection status */
  async getConnection(): Promise<GitHubConnection> {
    const token = await this.loadToken();
    if (!token) {
      return { connected: false };
    }

    // Verify token is still valid
    try {
      const octokit = new Octokit({ auth: token.accessToken });
      await octokit.users.getAuthenticated();
      return {
        connected: true,
        username: token.username,
        avatarUrl: token.avatarUrl,
      };
    } catch {
      // Token expired/revoked
      this.cachedToken = null;
      return { connected: false };
    }
  }

  /** List user's repositories */
  async listRepos(page = 1, perPage = 30): Promise<GitHubRepo[]> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: perPage,
      page,
    });

    return data.map(r => ({
      fullName: r.full_name,
      htmlUrl: r.html_url,
      private: r.private,
      cloneUrl: r.clone_url!,
    }));
  }

  /** Create a new repository */
  async createRepo(
    name: string,
    description: string,
    isPrivate: boolean,
  ): Promise<GitHubRepo> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name,
      description,
      private: isPrivate,
      auto_init: false,
    });

    log(`Created repo ${data.full_name}`);
    return {
      fullName: data.full_name,
      htmlUrl: data.html_url,
      private: data.private,
      cloneUrl: data.clone_url!,
    };
  }

  /** Get the stored access token (for git credential helper) */
  async getAccessToken(): Promise<string | null> {
    const token = await this.loadToken();
    return token?.accessToken ?? null;
  }

  /** Disconnect — delete stored token */
  async disconnect(): Promise<void> {
    this.cachedToken = null;
    if (existsSync(TOKEN_PATH)) {
      await unlink(TOKEN_PATH);
    }
    log('Disconnected from GitHub');
  }
}
