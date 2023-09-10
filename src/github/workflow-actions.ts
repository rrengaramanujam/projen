import { GitIdentity, GithubCredentials } from ".";
import { DEFAULT_GITHUB_ACTIONS_USER } from "./constants";
import { JobStep } from "./workflows-model";

function context(value: string) {
  return `\${{ ${value} }}`;
}

const REPO = context("github.repository");
const RUN_ID = context("github.run_id");
const SERVER_URL = context("github.server_url");
const RUN_URL = `${SERVER_URL}/${REPO}/actions/runs/${RUN_ID}`;
const GIT_PATCH_FILE_DEFAULT = ".repo.patch";
const RUNNER_TEMP = "${{ runner.temp }}";

/**
 * A set of utility functions for creating GitHub actions in workflows.
 */
export class WorkflowActions {
  /**
   * Creates a .patch file from the current git diff and uploads it as an
   * artifact. Use `checkoutWithPatch` to download and apply in another job.
   *
   * If a patch was uploaded, the action can optionally fail the job.
   *
   * @param options Options
   * @returns Job steps
   */
  public static uploadGitPatch(options: UploadGitPatchOptions): JobStep[] {
    const MUTATIONS_FOUND = `steps.${options.stepId}.outputs.${options.outputName}`;
    const GIT_PATCH_FILE = options.patchFile ?? GIT_PATCH_FILE_DEFAULT;

    const steps: JobStep[] = [
      {
        id: options.stepId,
        name: options.stepName ?? "Find mutations",
        run: [
          "git add .",
          `git diff --staged --patch --exit-code > ${GIT_PATCH_FILE} || echo "${options.outputName}=true" >> $GITHUB_OUTPUT`,
        ].join("\n"),
      },
      {
        if: MUTATIONS_FOUND,
        name: "Upload patch",
        uses: "actions/upload-artifact@v3",
        with: { name: GIT_PATCH_FILE, path: GIT_PATCH_FILE },
      },
    ];

    if (options.mutationError) {
      steps.push({
        name: "Fail build on mutation",
        if: MUTATIONS_FOUND,
        run: [
          `echo "::error::${options.mutationError}"`,
          `cat ${GIT_PATCH_FILE}`,
          "exit 1",
        ].join("\n"),
      });
    }

    return steps;
  }

  /**
   * Checks out a repository and applies a git patch that was created using
   * `uploadGitPatch`.
   *
   * @param options Options
   * @returns Job steps
   */
  public static checkoutWithPatch(
    options: CheckoutWithPatchOptions = {}
  ): JobStep[] {
    const GIT_PATCH_FILE = options.patchFile ?? GIT_PATCH_FILE_DEFAULT;

    return [
      {
        name: "Checkout",
        uses: "actions/checkout@v3",
        with: {
          token: options.token,
          ref: options.ref,
          repository: options.repository,
          ...(options.lfs ? { lfs: true } : {}),
        },
      },
      {
        name: "Download patch",
        uses: "actions/download-artifact@v3",
        with: { name: GIT_PATCH_FILE, path: RUNNER_TEMP },
      },
      {
        name: "Apply patch",
        run: `[ -s ${RUNNER_TEMP}/${GIT_PATCH_FILE} ] && git apply ${RUNNER_TEMP}/${GIT_PATCH_FILE} || echo "Empty patch. Skipping."`,
      },
    ];
  }

  /**
   * Configures the git identity (user name and email).
   * @param id The identity to use
   * @returns Job steps
   */
  public static setupGitIdentity(id: GitIdentity): JobStep[] {
    return [
      {
        name: "Set git identity",
        run: [
          `git config user.name "${id.name}"`,
          `git config user.email "${id.email}"`,
        ].join("\n"),
      },
    ];
  }

  /**
   * A step that creates a pull request based on the current repo state.
   *
   * @param options Options
   * @returns Job steps
   */
  public static createPullRequest(
    options: CreatePullRequestOptions
  ): JobStep[] {
    const workflowName = options.workflowName;
    const branchName = options.branchName ?? `github-actions/${workflowName}`;
    const stepId = options.stepId ?? "create-pr";
    const stepName = options.stepName ?? "Create Pull Request";
    const gitIdentity = options.gitIdentity ?? DEFAULT_GITHUB_ACTIONS_USER;
    const committer = `${gitIdentity.name} <${gitIdentity.email}>`;
    const pullRequestDescription = options.pullRequestDescription
      .trimEnd()
      .endsWith(".")
      ? options.pullRequestDescription.trimEnd()
      : `${options.pullRequestDescription.trimEnd()}.`;

    const title = options.pullRequestTitle;
    const description = [
      `${pullRequestDescription} See details in [workflow run].`,
      "",
      `[Workflow Run]: ${RUN_URL}`,
      "",
      "------",
      "",
      `*Automatically created by projen via the "${workflowName}" workflow*`,
    ].join("\n");

    return [
      {
        name: stepName,
        id: stepId,
        uses: "peter-evans/create-pull-request@v4",
        with: {
          token: options.credentials?.tokenRef,
          "commit-message": `${title}\n\n${description}`,
          branch: branchName,
          base: options.baseBranch,
          title: title,
          labels: options.labels?.join(",") || undefined,
          assignees: options.assignees?.join(",") || undefined,
          body: description,
          author: committer,
          committer: committer,
          signoff: options.signoff ?? true,
        },
      },
    ];
  }
}

/**
 * Options for `checkoutWithPatch`.
 */
export interface CheckoutWithPatchOptions {
  /**
   * The name of the artifact the patch is stored as.
   * @default ".repo.patch"
   */
  readonly patchFile?: string;

  /**
   * A GitHub token to use when checking out the repository.
   *
   * If the intent is to push changes back to the branch, then you must use a
   * PAT with `repo` (and possibly `workflows`) permissions.
   * @default - the default GITHUB_TOKEN is implicitly used
   */
  readonly token?: string;

  /**
   * Branch or tag name.
   * @default - the default branch is implicitly used
   */
  readonly ref?: string;

  /**
   * The repository (owner/repo) to use.
   * @default - the default repository is implicitly used
   */
  readonly repository?: string;

  /**
   * Whether LFS is enabled for the GitHub repository
   *
   * @default false
   */
  readonly lfs?: boolean;
}

/**
 * Options for `uploadGitPatch`.
 */
export interface UploadGitPatchOptions {
  /**
   * The step ID which produces the output which indicates if a patch was created.
   */
  readonly stepId: string;

  /**
   * The name of the step.
   * @default "Find mutations"
   */
  readonly stepName?: string;

  /**
   * The name of the artifact the patch is stored as.
   * @default ".repo.patch"
   */
  readonly patchFile?: string;

  /**
   * The name of the output to emit. It will be set to `true` if there was a diff.
   */
  readonly outputName: string;

  /**
   * Fail if a mutation was found and print this error message.
   * @default - do not fail upon mutation
   */
  readonly mutationError?: string;
}

export interface CreatePullRequestOptions {
  /**
   * The step ID which produces the output which indicates if a patch was created.
   * @default "create_pr"
   */
  readonly stepId?: string;

  /**
   * The name of the step displayed on GitHub.
   * @default "Create Pull Request"
   */
  readonly stepName?: string;

  /**
   * The job credentials used to create the pull request.
   *
   * Provided credentials must have permissions to create a pull request on the repository.
   */
  readonly credentials?: GithubCredentials;

  /**
   * The name of the workflow that will create the PR
   */
  readonly workflowName: string;

  /**
   * The full title used to create the pull request.
   *
   * If PR titles are validated in this repo, the title should comply with the respective rules.
   */
  readonly pullRequestTitle: string;

  /**
   * Description added to the pull request.
   *
   * Providence information are automatically added.
   */
  readonly pullRequestDescription: string;

  /**
   * Sets the pull request base branch.
   *
   * @default - The branch checked out in the workflow.
   */
  readonly baseBranch?: string;

  /**
   * The pull request branch name.
   *
   * @default `github-actions/${options.workflowName}`
   */
  readonly branchName?: string;

  /**
   * The git identity used to create the commit.
   * @default - the default github-actions user
   */
  readonly gitIdentity?: GitIdentity;

  /**
   * Add Signed-off-by line by the committer at the end of the commit log message.
   *
   * @default true
   */
  readonly signoff?: boolean;

  /**
   * Labels to apply on the PR.
   *
   * @default - no labels.
   */
  readonly labels?: string[];

  /**
   * Assignees to add on the PR.
   *
   * @default - no assignees
   */
  readonly assignees?: string[];
}
