<?php
// =====================================================================
//  BaseStudio - partie serveur (version Edge / XAMPP)
//  L'interface envoie ici des demandes en JSON, ce fichier parle à
//  MySQL avec mysqli et renvoie la réponse en JSON.
// =====================================================================

// Sécurité : seulement depuis ce PC, et seulement depuis BaseStudio
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($ip, ['127.0.0.1', '::1'], true)) { http_response_code(403); exit('Accès refusé'); }
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin)) { http_response_code(403); exit('Accès refusé'); }
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) { http_response_code(400); exit('JSON attendu'); }

header('Content-Type: application/json; charset=utf-8');
$cookiePath = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\') . '/';
session_name('BASESTUDIO');
session_set_cookie_params(['path' => $cookiePath, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

// ---------------------------------------------------------------------
//  Le mot de passe MySQL n'est jamais écrit en clair sur le disque.
//  PHP garde la session dans un fichier (C:\xampp\tmp) : on y range le
//  mot de passe CHIFFRÉ (AES-256-GCM). La clé, elle, reste dans un cookie
//  du navigateur (HttpOnly, effacé à la fermeture de l'appli). Le fichier
//  de session seul ne permet donc pas de retrouver le mot de passe.
// ---------------------------------------------------------------------
const KEY_COOKIE = 'BASESTUDIO_K';
function session_key($create = false) {
    global $cookiePath;
    $k = isset($_COOKIE[KEY_COOKIE]) ? base64_decode($_COOKIE[KEY_COOKIE], true) : false;
    if ($k !== false && strlen($k) === 32 && !$create) return $k;
    if (!$create) return null;
    $k = random_bytes(32);
    setcookie(KEY_COOKIE, base64_encode($k), ['path' => $cookiePath, 'httponly' => true, 'samesite' => 'Strict']);
    $_COOKIE[KEY_COOKIE] = base64_encode($k);
    return $k;
}
function seal($plain) {
    $k = session_key(true);
    $iv = random_bytes(12);
    $ct = openssl_encrypt((string)$plain, 'aes-256-gcm', $k, OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $ct);
}
function unseal($b64) {
    $k = session_key();
    $raw = $k ? base64_decode((string)$b64, true) : false;
    if ($raw === false || strlen($raw) < 28) return null;
    $p = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', $k, OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $p === false ? null : $p;
}
function forget_login() {
    global $cookiePath;
    unset($_SESSION['cfg']);
    setcookie(KEY_COOKIE, '', ['expires' => 1, 'path' => $cookiePath, 'httponly' => true, 'samesite' => 'Strict']);
}
mysqli_report(MYSQLI_REPORT_OFF);   // on gère les erreurs nous-mêmes
set_time_limit(0);
ini_set('memory_limit', '1024M');

$in = json_decode(file_get_contents('php://input'), true) ?: [];

// ---------------------------------------------------------------------
//  Petits outils
// ---------------------------------------------------------------------
function reply($data) { echo json_encode(['ok' => true, 'data' => $data], JSON_INVALID_UTF8_SUBSTITUTE); exit; }
function fail($msg, $code = '') { echo json_encode(['ok' => false, 'error' => $msg, 'code' => $code], JSON_INVALID_UTF8_SUBSTITUTE); exit; }

// Ouvre la connexion avec les infos gardées en session
function db() {
    static $c = null;
    if ($c) return $c;
    $cfg = $_SESSION['cfg'] ?? null;
    // ancienne session (mot de passe en clair) ou clé perdue : on redemande la connexion
    $pw = is_array($cfg) && isset($cfg['pass']) && !isset($cfg['password']) ? unseal($cfg['pass']) : null;
    if ($pw === null) { forget_login(); fail("Pas connecté au serveur MySQL (reconnecte-toi).", 'NOT_CONNECTED'); }
    $c = open_conn(['host' => $cfg['host'], 'port' => $cfg['port'], 'user' => $cfg['user'], 'password' => $pw]);
    return $c;
}
function open_conn($cfg) {
    $c = mysqli_init();
    $c->options(MYSQLI_OPT_INT_AND_FLOAT_NATIVE, 1);   // nombres en vrais nombres
    $c->options(MYSQLI_OPT_CONNECT_TIMEOUT, 8);
    $host = ($cfg['host'] ?? 'localhost') === 'localhost' ? '127.0.0.1' : $cfg['host'];
    if (!@$c->real_connect($host, $cfg['user'] ?? 'root', $cfg['password'] ?? '', null, (int)($cfg['port'] ?? 3306))) {
        $errno = mysqli_connect_errno();
        $msg = mysqli_connect_error();
        $code = $errno === 1045 ? 'ER_ACCESS_DENIED_ERROR' : ($errno === 2002 ? 'ECONNREFUSED' : 'ER_' . $errno);
        fail($msg, $code);
    }
    $c->set_charset('utf8mb4');
    return $c;
}

// Échappement des valeurs pour remplacer les "?" et "??"
function esc_val($c, $v) {
    if ($v === null) return 'NULL';
    if (is_bool($v)) return $v ? 'true' : 'false';
    if (is_int($v) || is_float($v)) return (string)$v;
    return "'" . $c->real_escape_string((string)$v) . "'";
}
function esc_id($name) { return '`' . str_replace('`', '``', (string)$name) . '`'; }
function format_sql($c, $sql, $params) {
    if (!$params) return $sql;
    $i = 0;
    return preg_replace_callback('/\?\??/', function ($m) use ($c, $params, &$i) {
        if ($i >= count($params)) return $m[0];
        $v = $params[$i++];
        return $m[0] === '??' ? esc_id($v) : esc_val($c, $v);
    }, $sql);
}

// Rend une valeur affichable (binaire -> 0x..., grands entiers -> texte)
function clean($v) {
    if (is_string($v) && !mb_check_encoding($v, 'UTF-8')) {
        return '0x' . substr(bin2hex($v), 0, 64) . (strlen($v) > 32 ? '…' : '');
    }
    if (is_int($v) && abs($v) > 9007199254740991) return (string)$v;
    return $v;
}

// Exécute une ou plusieurs requêtes, renvoie la liste des résultats
function run_sql($c, $sql) {
    $results = [];
    $GLOBALS['sql_done'] = 0;
    if (!$c->multi_query($sql)) {
        throw new Exception($c->error, $c->errno);
    }
    do {
        $res = $c->store_result();
        if ($res instanceof mysqli_result) {
            $cols = array_map(fn($f) => $f->name, $res->fetch_fields());
            $rows = [];
            while ($r = $res->fetch_row()) $rows[] = array_map('clean', $r);
            $res->free();
            $results[] = ['type' => 'rows', 'columns' => $cols, 'rows' => $rows];
        } elseif ($c->errno) {
            break;
        } else {
            $results[] = ['type' => 'info', 'affectedRows' => max(0, $c->affected_rows), 'insertId' => $c->insert_id, 'info' => (string)$c->info];
        }
        if (!$c->more_results()) break;
        if (!$c->next_result()) {   // erreur dans une des requêtes suivantes
            break;
        }
    } while (true);
    $GLOBALS['sql_done'] = count($results);   // nombre de requêtes réussies (utile si erreur)
    if ($c->errno) throw new Exception($c->error, $c->errno);
    return $results;
}

function rows_of($c, $sql) {
    $r = run_sql($c, $sql);
    return ($r[0]['type'] ?? '') === 'rows' ? $r[0]['rows'] : [];
}

// ---------------------------------------------------------------------
//  Mises à jour : l'appli se met à jour depuis le repo GitHub public.
//  version.json (publié avec l'appli) donne le numéro de version, les
//  nouveautés et la liste des fichiers avec leur empreinte SHA-256.
//  Chaque fichier téléchargé est vérifié avant d'être écrit.
// ---------------------------------------------------------------------
const UPDATE_REPO = 'CloudThis/basestudio';

function http_get($url) {
    $ctx = stream_context_create(['http' => [
        'header' => "User-Agent: BaseStudio-updater\r\nAccept: */*\r\n",
        'timeout' => 20, 'ignore_errors' => true, 'follow_location' => 1
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
    return [$code, $body === false ? '' : $body];
}
function raw_url($ref, $path) {
    return 'https://raw.githubusercontent.com/' . UPDATE_REPO . '/' . $ref . '/basestudio/' . implode('/', array_map('rawurlencode', explode('/', $path)));
}
function local_version() {
    $v = json_decode((string)@file_get_contents(__DIR__ . '/version.json'), true);
    return is_array($v) && !empty($v['version']) ? $v['version'] : '0.0.0';
}
function valid_ref($ref) { return $ref === 'main' || preg_match('/^[0-9a-f]{40}$/', $ref); }

// ---------------------------------------------------------------------
//  Les actions
// ---------------------------------------------------------------------
try {
    switch ($in['action'] ?? '') {

        // Y a-t-il une version plus récente sur GitHub ?
        case 'update_check': {
            // le dernier commit (pour lire tous les fichiers d'une même version)
            $ref = 'main';
            [$code, $body] = http_get('https://api.github.com/repos/' . UPDATE_REPO . '/commits/main');
            if ($code === 200) { $j = json_decode($body, true); if (!empty($j['sha']) && valid_ref($j['sha'])) $ref = $j['sha']; }
            [$code, $body] = http_get(raw_url($ref, 'version.json'));
            if ($code !== 200) fail('Impossible de joindre GitHub pour vérifier les mises à jour (pas d\'internet ?).', 'UPDATE_OFFLINE');
            $remote = json_decode($body, true);
            if (!is_array($remote) || empty($remote['version'])) fail('Le fichier de version publié est illisible.');
            $current = local_version();
            reply(['current' => $current, 'latest' => $remote['version'], 'date' => $remote['date'] ?? '',
                   'notes' => array_values(array_filter((array)($remote['notes'] ?? []), 'is_string')),
                   'ref' => $ref, 'newer' => version_compare($remote['version'], $current, '>')]);
        }

        // Télécharge la nouvelle version, vérifie chaque fichier, sauvegarde l'ancienne, puis remplace
        // Quelle version est gardée dans _sauvegarde/ ? (null s'il n'y en a pas)
        case 'update_backup': {
            $v = json_decode((string)@file_get_contents(__DIR__ . '/_sauvegarde/version.json'), true);
            reply(is_array($v) && !empty($v['version']) ? ['version' => $v['version'], 'date' => $v['date'] ?? ''] : null);
        }

        // Revenir à la version gardée dans _sauvegarde/. On ÉCHANGE : la version
        // qu'on quitte devient la sauvegarde, pour pouvoir y revenir ensuite.
        case 'update_rollback': {
            $bak = __DIR__ . '/_sauvegarde';
            $names = array_values(array_filter(scandir($bak) ?: [], fn($e) => is_file("$bak/$e") && preg_match('/^[A-Za-z0-9_.-]+$/', $e)));
            if (!in_array('version.json', $names, true)) fail('Aucune version précédente n\'est gardée sur ce PC.');
            $old = []; foreach ($names as $e) $old[$e] = file_get_contents("$bak/$e");
            $cur = []; foreach (scandir(__DIR__) as $e) if (is_file(__DIR__ . "/$e")) $cur[$e] = file_get_contents(__DIR__ . "/$e");
            foreach ($old as $e => $data) {
                if (@file_put_contents(__DIR__ . "/$e", $data) === false) {
                    foreach ($cur as $k => $d) @file_put_contents(__DIR__ . "/$k", $d);   // on remet tout comme avant
                    fail("Impossible d'écrire $e (droits du dossier ?). Rien n'a changé.");
                }
            }
            foreach (glob($bak . '/*') ?: [] as $f) if (is_file($f)) @unlink($f);
            foreach ($cur as $e => $d) @file_put_contents("$bak/$e", $d);
            $v = json_decode($old['version.json'], true);
            reply(['version' => $v['version'] ?? '?']);
        }

        case 'update_install': {
            $ref = (string)($in['ref'] ?? 'main');
            if (!valid_ref($ref)) fail('Version demandée invalide.');
            [$code, $manifest] = http_get(raw_url($ref, 'version.json'));
            $remote = $code === 200 ? json_decode($manifest, true) : null;
            if (!is_array($remote) || empty($remote['files'])) fail('Impossible de lire la liste des fichiers de la mise à jour.');
            $got = [];
            foreach ($remote['files'] as $f) {
                $p = (string)($f['path'] ?? ''); $h = strtolower((string)($f['sha256'] ?? ''));
                // uniquement des fichiers de l'appli, jamais en dehors du dossier
                if (!preg_match('#^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$#', $p) || strpos($p, '..') !== false
                    || $p === 'version.json' || strpos($p, '_sauvegarde') === 0 || !preg_match('/^[0-9a-f]{64}$/', $h)) fail("Fichier refusé dans la mise à jour : $p");
                [$c, $data] = http_get(raw_url($ref, $p));
                if ($c !== 200) fail("Téléchargement impossible : $p");
                if (hash('sha256', $data) !== $h) fail("Fichier abîmé pendant le téléchargement : $p. Rien n'a été modifié, réessaie plus tard.");
                $got[$p] = $data;
            }
            // sauvegarde de la version actuelle dans _sauvegarde/
            $bak = __DIR__ . '/_sauvegarde';
            if (is_dir($bak)) foreach (glob($bak . '/*') ?: [] as $old) if (is_file($old)) @unlink($old);
            @mkdir($bak);
            $saved = [];
            foreach (scandir(__DIR__) as $e) {
                if (is_file(__DIR__ . "/$e") && copy(__DIR__ . "/$e", "$bak/$e")) $saved[] = $e;
            }
            // on écrit ; au moindre problème, on remet la sauvegarde
            foreach ($got as $p => $data) {
                $dest = __DIR__ . '/' . $p;
                if (!is_dir(dirname($dest))) @mkdir(dirname($dest), 0777, true);
                if (@file_put_contents($dest, $data) === false) {
                    foreach ($saved as $e) @copy("$bak/$e", __DIR__ . "/$e");
                    fail("Impossible d'écrire $p (droits du dossier ?). L'ancienne version a été remise.");
                }
            }
            file_put_contents(__DIR__ . '/version.json', $manifest);
            reply(['version' => $remote['version'], 'files' => count($got)]);
        }

        case 'connect': {
            $cfg = $in['cfg'] ?? [];
            $c = open_conn($cfg);
            session_regenerate_id(true);   // nouvelle session, l'ancien fichier est effacé
            $_SESSION['cfg'] = ['host' => (string)($cfg['host'] ?? 'localhost'), 'port' => (int)($cfg['port'] ?? 3306),
                                'user' => (string)($cfg['user'] ?? 'root'), 'pass' => seal($cfg['password'] ?? '')];
            $r = rows_of($c, 'SELECT VERSION(), CURRENT_USER()');
            reply(['version' => $r[0][0], 'user' => $r[0][1]]);
        }

        case 'disconnect':
            forget_login();
            session_destroy();
            reply(true);

        case 'query': {
            $c = db();
            if (!empty($in['database'])) {
                if (!$c->select_db($in['database'])) fail($c->error, 'ER_' . $c->errno);
            }
            $sql = format_sql($c, $in['sql'] ?? '', $in['params'] ?? []);
            $t = microtime(true);
            $results = run_sql($c, $sql);
            reply(['results' => $results, 'time' => (int)round((microtime(true) - $t) * 1000)]);
        }

        case 'export': {
            $c = db();
            $db = $in['database'];
            $only = $in['table'] ?? null;
            $withData = ($in['withData'] ?? true) !== false;
            $out = ["-- Export BaseStudio", "-- Base : $db", "-- Date : " . date('d/m/Y H:i:s'), "",
                    "SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;", ""];
            if (!$only) { $out[] = "CREATE DATABASE IF NOT EXISTS " . esc_id($db) . ";"; $out[] = "USE " . esc_id($db) . ";"; $out[] = ""; }
            $c->select_db($db);
            foreach (rows_of($c, 'SHOW FULL TABLES') as [$name, $kind]) {
                if ($only && $name !== $only) continue;
                if ($kind === 'VIEW') {
                    $cv = rows_of($c, 'SHOW CREATE VIEW ' . esc_id($name));
                    $out[] = "-- Vue `$name`"; $out[] = "DROP VIEW IF EXISTS " . esc_id($name) . ";"; $out[] = $cv[0][1] . ";"; $out[] = "";
                    continue;
                }
                $ct = rows_of($c, 'SHOW CREATE TABLE ' . esc_id($name));
                $out[] = "-- --------------------------------------------------";
                $out[] = "-- Table `$name`";
                $out[] = "-- --------------------------------------------------";
                $out[] = "DROP TABLE IF EXISTS " . esc_id($name) . ";";
                $out[] = $ct[0][1] . ";"; $out[] = "";
                if ($withData) {
                    $res = $c->query('SELECT * FROM ' . esc_id($name));
                    $batch = [];
                    while ($r = $res->fetch_row()) {
                        $batch[] = '(' . implode(', ', array_map(fn($v) => esc_val($c, $v), $r)) . ')';
                        if (count($batch) === 100) { $out[] = "INSERT INTO " . esc_id($name) . " VALUES\n" . implode(",\n", $batch) . ";"; $batch = []; }
                    }
                    if ($batch) $out[] = "INSERT INTO " . esc_id($name) . " VALUES\n" . implode(",\n", $batch) . ";";
                    $res->free();
                    $out[] = "";
                }
            }
            // Procédures et fonctions (seulement pour l'export d'une base entière)
            $trg = [];
            if (!$only) {
                foreach (['PROCEDURE', 'FUNCTION'] as $kind) {
                    foreach (rows_of($c, "SHOW $kind STATUS WHERE Db = " . esc_val($c, $db)) as $r) {
                        $cr = rows_of($c, "SHOW CREATE $kind " . esc_id($r[1]));
                        if (empty($cr[0][2])) continue;   // code non lisible (pas les droits)
                        $trg[] = "DROP $kind IF EXISTS " . esc_id($r[1]) . " //";
                        $trg[] = preg_replace('/\sDEFINER=`[^`]*`@`[^`]*`/', '', $cr[0][2]) . " //";
                        $trg[] = "";
                    }
                }
            }
            // Triggers (écrits avec DELIMITER, comme phpMyAdmin)
            foreach (rows_of($c, 'SHOW TRIGGERS') as $t) {
                if ($only && $t[2] !== $only) continue;
                $ct = rows_of($c, 'SHOW CREATE TRIGGER ' . esc_id($t[0]));
                $trg[] = "DROP TRIGGER IF EXISTS " . esc_id($t[0]) . " //";
                $trg[] = preg_replace('/\sDEFINER=`[^`]*`@`[^`]*`/', '', $ct[0][2]) . " //";
                $trg[] = "";
            }
            if ($trg) {
                $out[] = "-- --------------------------------------------------";
                $out[] = "-- Procédures, fonctions et triggers";
                $out[] = "-- --------------------------------------------------";
                $out[] = "DELIMITER //";
                array_push($out, ...$trg);
                $out[] = "DELIMITER ;";
                $out[] = "";
            }
            $out[] = "SET FOREIGN_KEY_CHECKS = 1;";
            reply(implode("\n", $out));
        }

        case 'import': {
            $c = db();
            if (!empty($in['database'])) $c->select_db($in['database']);
            // l'interface envoie le fichier par paquets ; si une requête échoue,
            // on dit combien de requêtes du paquet étaient passées avant elle
            try { $results = run_sql($c, $in['sql'] ?? ''); }
            catch (Throwable $e) {
                echo json_encode(['ok' => false, 'error' => $e->getMessage(), 'code' => 'ER_' . $e->getCode(), 'done' => $GLOBALS['sql_done'] ?? 0], JSON_INVALID_UTF8_SUBSTITUTE);
                exit;
            }
            reply(['count' => count($results)]);
        }

        default:
            fail('Action inconnue');
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 'ER_' . $e->getCode());
}
