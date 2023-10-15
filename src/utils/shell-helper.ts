import escape_if_necessary from "./sh-escape.ts"

export function unset_vars(is_fish: boolean, vars: string[]) {
  if (is_fish) {
    return `set -e ${vars.join(' ')}`
  } else {
    return `unset ${vars.join(' ')}`
  }
}

// TODO not sure if we need to do anything different here
function escape_if_necessary_fish(x: string) {
  x = x.replaceAll(/\$\{([^}]+)\}/g, (_match, group1) => `$${group1}`)
  /// `$` because we add some env vars recursively
  if (!/\s/.test(x) && !/['"$><]/.test(x)) return x
  if (!x.includes('"')) return `"${x}"`
  if (!x.includes("'")) return `'${x}'`
  x = x.replaceAll('"', '\\"')
  return `"${x}"`
}

export function export_var(is_fish: boolean, key: string, value: string, escape = false) {
  if (is_fish) {
    if (escape) {
      value = escape_if_necessary_fish(value)
    }
    return `set -g -x ${key} ${value}`
  } else {
    if (escape) {
      value = escape_if_necessary(value)
    }
    return `export ${key}=${value}`
  }
}

export function shell_function_start(is_fish: boolean, name: string) {
  if (is_fish) {
    return `function ${name}`
  } else {
    return `${name}() {`
  }
}

export function shell_function_end(is_fish: boolean) {
  if (is_fish) {
    return `end`
  } else {
    return `}`
  }
}
