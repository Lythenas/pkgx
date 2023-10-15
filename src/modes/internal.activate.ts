import escape_if_necessary from "../utils/sh-escape.ts"
import { PackageRequirement, Path, PkgxError, hooks, utils } from "pkgx"
import { unset_vars, export_var, shell_function_start, shell_function_end } from "../utils/shell-helper.ts"
import construct_env  from "../prefab/construct-env.ts"
import install, { Logger } from "../prefab/install.ts"
import { blurple } from "../utils/color.ts"
import devenv from "../utils/devenv.ts"
import undent from "outdent"

export default async function(dir: Path, { powder, ...opts }: { powder: PackageRequirement[], logger: Logger, fish: boolean }) {
  const { install, construct_env, datadir, getenv } = _internals

  if (!dir.isDirectory()) {
    throw new PkgxError(`not a directory: ${dir}`)
  }
  if (dir.eq(Path.home()) || dir.eq(Path.root)) {
    throw new PkgxError(`refusing to activate: ${dir}`)
  }

  const { pkgs, env: userenv } = await devenv(dir)

  const devenv_pkgs = [...pkgs]
  pkgs.push(...powder)

  if (pkgs.length <= 0 && Object.keys(userenv).length <= 0) {
    throw new PkgxError("no env")
  }

  /// indicate to our shell scripts that this devenv is activated
  const persistence = datadir().join("dev", dir.string.slice(1)).mkdir('p').join("dev.pkgx.activated").touch()

  const installations = await install(pkgs, { update: false, ...opts })
  const env = await construct_env(installations)

  /// we only want to tell the user about NEW packages added to the env
  const rv_pkgenv = (installed => {
    const set = new Set(devenv_pkgs.map(({project}) => project))
    return installed.filter(x => set.has(x.project))
  })(installations.pkgenv)

  let rv = ''

  /// env specified in devenv files takes precedence
  Object.assign(env, userenv)

  for (const [key, value] of Object.entries(env)) {

    const existing_value = getenv(key)
    if (value == existing_value) {
      delete env[key]
      continue
    }

    //NOTE strictly env which we model ourselves on does not do value escaping which results in output
    // that cannot be sourced if the value contains spaces
    rv += export_var(opts.fish, key, value, true)
    rv += '\n'
  }

  // if (/\(pkgx\)/.test(getenv("PS1") ?? '') == false) {
  //   //FIXME doesn't work with warp.dev for fuck knows why reasons
  //   // https://github.com/warpdotdev/Warp/issues/3492
  //   rv += `export PS1="(pkgx) $PS1"\n`
  // }

  rv += export_var(opts.fish, "PKGX_POWDER", installations.pkgenv.map(utils.pkg.str).join(' '), true)
  rv += "\n"
  rv += export_var(opts.fish, "PKGX_PKGENV", installations.installations.map(({pkg}) => utils.pkg.str(pkg)).join(' '), true)
  rv += "\n\n"

  rv += shell_function_start(opts.fish, "_pkgx_reset")
  rv += "\n"
  for (const key in env) {
    const old = getenv(key)
    if (old !== undefined) {
      //TODO don’t export if not currently exported!
      rv += `  ${export_var(opts.fish, key, old, true)}\n`
    } else {
      rv += `  ${unset_vars(opts.fish, [key])}\n`
    }
  }

  // const ps1 = getenv('PS1')
  // rv += ps1 ? `  export PS1="${ps1}"\n` : "  unset PS1\n"
  // rv += "  unset -f _pkgx_reset\n"

  rv += shell_function_end(opts.fish)
  rv += "\n\n"

  const raw_off_string = rv_pkgenv.map(x => `-${utils.pkg.str(x)}`).join(' ')
  const off_string = rv_pkgenv.map(x => `-${escape_if_necessary(utils.pkg.str(x))}`).join(' ')

  if (opts.fish) {
    rv += undent`
      function _pkgx_should_deactivate_devenv
        set -l suffix (string replace --regex -- ^(string escape --style=regex -- "${dir}") "" $PWD)
        test "$PWD" != "${dir}$suffix"
      end

      function _pkgx_dev_off
        echo '${blurple('env')} ${raw_off_string}' >&2

        env ${off_string}

        if text $argv[1] != --shy
          rm "${persistence}"
        end

        functions -e _pkgx_dev_off _pkgx_should_deactivate_devenv

    `
  } else {
    rv += undent`
      _pkgx_should_deactivate_devenv() {
        suffix="\${PWD#"${dir}"}"
        test "$PWD" != "${dir}$suffix"
      }

      _pkgx_dev_off() {
        echo '${blurple('env')} ${raw_off_string}' >&2

        env ${off_string}

        if [ "$1" != --shy ]; then
          rm "${persistence}"
        fi

        unset -f _pkgx_dev_off _pkgx_should_deactivate_devenv

    `
  }

  for (const key in userenv) {
    const value = getenv(key)
    if (value) {
      rv += `  ${export_var(opts.fish, key, value, true)}\n`
    } else {
      rv += `  ${unset_vars(opts.fish, [key])}\n`
    }
  }

  rv += shell_function_end(opts.fish)

  return [rv, rv_pkgenv] as [string, PackageRequirement[]]
}

export const _internals = {
  install,
  construct_env,
  datadir: () => hooks.useConfig().data,
  getenv: Deno.env.get
}
