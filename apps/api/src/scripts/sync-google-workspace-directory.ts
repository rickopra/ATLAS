import { syncGoogleWorkspaceDirectoryToEmployees } from '../services/google-workspace-directory.js';

async function main() {
  const result = await syncGoogleWorkspaceDirectoryToEmployees();
  if (!result.success) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Google Workspace Directory sync failed.'
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
