const { execFile: defaultExecFile } = require('node:child_process');
const defaultFs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MAX_PROCESSES = 4;
const MAX_PORTS = 8;
const LANGUAGE_SERVER = /[/\\]language[_-]server(?:[_-][a-z0-9]+)*(?:\.exe)?$/i;

// Command lines are consumed internally, never returned or logged. No process
// is started except the OS inspection utilities; no provider files are read.
const WINDOWS_PROBE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$records = @()
$candidates = Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE 'language%server%'"
foreach ($candidate in $candidates) {
  if ($records.Count -ge 4) { break }
  if (-not $candidate.ExecutablePath -or -not $candidate.CommandLine) { continue }
  if ($candidate.ExecutablePath -notmatch '(?i)[\\/]Antigravity(?: IDE)?[\\/]') { continue }
  try {
    $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $currentSid) { continue }
    $ports = @(Get-NetTCPConnection -State Listen -OwningProcess $candidate.ProcessId -ErrorAction Stop | Select-Object -ExpandProperty LocalPort)
    $records += [pscustomobject]@{
      pid = [int]$candidate.ProcessId
      ownerSid = $owner.Sid
      executablePath = $candidate.ExecutablePath
      commandLine = $candidate.CommandLine
      ports = $ports
    }
  } catch { continue }
}
[pscustomobject]@{ currentSid = $currentSid; processes = $records } | ConvertTo-Json -Depth 4 -Compress
`;

function inspect(execFile, file, args, signal) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, {
        encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024,
        windowsHide: true, ...(signal ? { signal } : {})
      }, (error, stdout) => resolve(error ? '' : String(stdout || '')));
    } catch { resolve(''); }
  });
}

function flag(command, name) {
  const match = command.match(new RegExp(`(?:^|\\s)--${name}(?:\\s*=\\s*|\\s+)(?:"([^"\\r\\n]+)"|'([^'\\r\\n]+)'|([^\\s]+))`));
  return match ? match[1] || match[2] || match[3] : null;
}

function csrf(value) {
  return typeof value === 'string' && /^[a-z0-9._~+/=-]{1,512}$/i.test(value) ? value : null;
}

function validPid(value) {
  return Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}

function ports(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0 && value <= 65535))].slice(0, MAX_PORTS);
}

function endpoints(record, ownedPorts) {
  const token = csrf(flag(record.commandLine, 'csrf_token'));
  if (!token) return [];
  const extensionPort = Number(flag(record.commandLine, 'extension_server_port'));
  const extensionToken = csrf(flag(record.commandLine, 'extension_server_csrf_token'));
  const httpPort = extensionToken && ownedPorts.includes(extensionPort) ? extensionPort : null;
  return [
    ...(httpPort ? [{ pid: record.pid, port: httpPort, protocol: 'http:', csrfToken: extensionToken }] : []),
    ...ownedPorts.filter((port) => port !== httpPort).map((port) => ({
      pid: record.pid, port, protocol: 'https:', csrfToken: token
    }))
  ];
}

function trustedMacPath(file, homeDir) {
  const roots = ['/Applications', path.posix.join(homeDir, 'Applications')];
  return roots.some((root) => {
    const relative = path.posix.relative(root, file);
    return /^(?:Antigravity|Antigravity IDE)\.app\/Contents\/(?:Resources|MacOS)\//.test(relative);
  });
}

function trustedWindowsPath(file, env) {
  const normalized = path.win32.normalize(file.replace(/^\\\\\?\\/, '')).toLowerCase();
  const roots = [
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'),
    env.ProgramFiles || env.PROGRAMFILES,
    env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)']
  ].filter((root) => typeof root === 'string' && path.win32.isAbsolute(root));
  return roots.some((root) => {
    const relative = path.win32.relative(path.win32.normalize(root).toLowerCase(), normalized);
    return /^(?:antigravity|antigravity ide)\\resources\\app\\/.test(relative);
  });
}

async function trustedExecutable(file, options) {
  try {
    if (typeof file !== 'string' || !LANGUAGE_SERVER.test(file)) return false;
    const real = await options.fs.realpath(file);
    if (typeof real !== 'string' || !LANGUAGE_SERVER.test(real)) return false;
    const trusted = options.platform === 'darwin'
      ? trustedMacPath(real, options.homeDir)
      : trustedWindowsPath(real, options.env);
    if (!trusted) return false;
    const stat = await options.fs.stat(real);
    return stat.isFile() && (options.platform !== 'darwin' || (stat.mode & 0o111) !== 0);
  } catch { return false; }
}

function macCandidates(stdout, uid) {
  return stdout.split('\n').map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match || Number(match[2]) !== uid) return null;
    const commandLine = match[3];
    const pid = Number(match[1]);
    return validPid(pid) && /antigravity/i.test(commandLine) && /language[_-]server/i.test(commandLine)
      && csrf(flag(commandLine, 'csrf_token')) ? { pid, commandLine } : null;
  }).filter(Boolean).slice(0, MAX_PROCESSES);
}

async function discoverMac(options) {
  if (!Number.isInteger(options.uid) || options.uid < 0) return [];
  const output = await inspect(options.execFile, '/bin/ps', ['-axo', 'pid=,uid=,args='], options.signal);
  const batches = await Promise.all(macCandidates(output, options.uid).map(async (record) => {
    const [text, listeners] = await Promise.all([
      inspect(options.execFile, '/usr/sbin/lsof', ['-a', '-p', String(record.pid), '-d', 'txt', '-Fpun'], options.signal),
      inspect(options.execFile, '/usr/sbin/lsof', ['-nP', '-a', '-p', String(record.pid), '-iTCP', '-sTCP:LISTEN', '-Fpun'], options.signal)
    ]);
    if (!text.split('\n').includes(`p${record.pid}`) || !text.split('\n').includes(`u${options.uid}`)
      || !listeners.split('\n').includes(`p${record.pid}`) || !listeners.split('\n').includes(`u${options.uid}`)) return [];
    const executablePaths = text.split('\n').filter((line) => line.startsWith('n')).map((line) => line.slice(1));
    const trusted = await Promise.all(executablePaths.filter((file) => LANGUAGE_SERVER.test(file))
      .map((file) => trustedExecutable(file, options)));
    if (!trusted.some(Boolean)) return [];
    const ownedPorts = ports(listeners.split('\n').map((line) => {
      const match = line.match(/^n.*:(\d+)$/);
      return match ? Number(match[1]) : null;
    }));
    return endpoints(record, ownedPorts);
  }));
  return batches.flat();
}

async function discoverWindows(options) {
  const systemRoot = options.env.SystemRoot || options.env.SYSTEMROOT || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(WINDOWS_PROBE, 'utf16le').toString('base64');
  const output = await inspect(options.execFile, powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], options.signal);
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed.currentSid !== 'string' || !parsed.currentSid.startsWith('S-1-') || !Array.isArray(parsed.processes)) return [];
    const candidates = parsed.processes.filter((record) => record && validPid(record.pid)
      && record.ownerSid === parsed.currentSid && typeof record.commandLine === 'string'
      && csrf(flag(record.commandLine, 'csrf_token'))).slice(0, MAX_PROCESSES);
    const batches = await Promise.all(candidates.map(async (record) => await trustedExecutable(record.executablePath, options)
      ? endpoints(record, ports(record.ports)) : []));
    return batches.flat();
  } catch { return []; }
}

async function discoverAntigravityEndpoints(overrides = {}) {
  const options = {
    platform: process.platform, env: process.env, execFile: defaultExecFile, fs: defaultFs,
    homeDir: os.homedir(), uid: typeof process.getuid === 'function' ? process.getuid() : null,
    ...overrides
  };
  if (options.signal?.aborted) return [];
  try {
    if (options.platform === 'darwin') return await discoverMac(options);
    if (options.platform === 'win32') return await discoverWindows(options);
    return [];
  } catch { return []; }
}

module.exports = { discoverAntigravityEndpoints };
