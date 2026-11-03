import { fileURLToPath } from 'node:url';

/** @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi */
export default function (pi) {
  const launcher = fileURLToPath(new URL('../launcher/serve.mjs', import.meta.url));
  for (const name of ['design-system', 'design', 'design-integrate']) {
    const skill = fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url));
    pi.registerCommand(`open-designer:${name}`, {
      description: `Open Designer: ${name}`,
      handler: async (args, ctx) => {
        pi.sendUserMessage(
          `Read ${JSON.stringify(skill)} and follow its workflow, including ../HOST.md. ` +
          `The installed viewer launcher is ${JSON.stringify(launcher)}; run it with node from the user's project root, not the package directory.\n\n` +
          args,
          ctx.isIdle() ? undefined : { deliverAs: 'followUp' },
        );
      },
    });
  }
}
