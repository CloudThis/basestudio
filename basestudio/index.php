<?php
// =====================================================================
//  BaseStudio - page d'accueil (http://localhost/basestudio/)
//  Apache ouvre index.php avant index.html. Ce fichier renvoie
//  index.html en ajoutant à chaque .js / .css un numéro de version égal
//  à sa date de modification : dès qu'un fichier change, Edge le
//  recharge tout seul (plus de vieux fichiers gardés en cache).
// =====================================================================
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

$html = file_get_contents(__DIR__ . '/index.html');
echo preg_replace_callback('/\b(src|href)="([\w.-]+\.(?:js|css))(?:\?[^"]*)?"/', function ($m) {
    $file = __DIR__ . '/' . $m[2];
    $v = is_file($file) ? filemtime($file) : 0;
    return $m[1] . '="' . $m[2] . '?v=' . $v . '"';
}, $html);
