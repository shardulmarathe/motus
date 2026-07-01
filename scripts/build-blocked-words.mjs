/**
 * Builds src/lib/blocked-words.json from public blocklists + custom terms.
 * Run: node scripts/build-blocked-words.mjs
 */
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const SOURCES = [
  'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en',
  'https://raw.githubusercontent.com/coffee-and-fun/google-profanity-words/main/data/en.txt',
  'https://www.cs.cmu.edu/~biglou/resources/bad-words.txt',
]

const CUSTOM_WORDS = [
  // Modern internet / meme / pop-culture
  'goon', 'gooner', 'gooning', 'goons', 'simp', 'simping', 'simps', 'incel', 'incels',
  'coomer', 'cooming', 'coom', 'thot', 'thots', 'egirl', 'eboi', 'femboy', 'femboys',
  'onlyfans', 'onlyfan', 'ofgirl', 'hentai', 'rule34', 'loli', 'lolicon', 'shota',
  'shotacon', 'netorare', 'ntr', 'waifu', 'weeb', 'weeaboo', 'yiff', 'yiffer',
  'zoophile', 'groomer', 'grooming', 'sendnudes', 'paypig', 'cuckold', 'cucked',
  'mgtow', 'redpill', 'blackpill', 'sigma', 'skibidi', 'brainrot', 'pornsick',
  'twitchthot', 'stepbro', 'stepsis', 'cornhub', 'deeznuts', 'alphamale',
  'hotwife', 'dilf', 'milf', 'trap', 'femcel', 'niceguy', 'soyboy', 'basedgod',
  'memesex', 'oppai', 'ahegao', 'bussy', 'thicc', 'gyatt', 'rizzler', 'fanum',
  'skibiditoilet', 'ohio', 'mewing', 'looksmax', 'bonesmash', 'edging', 'edge',
  'goontok', 'goonhub', 'goonette', 'goonbait', 'pornbrain', 'nsfw', 'lewd',
  'lewds', 'horny', 'horni', 'hornyaf', 'downbad', 'downbadaf', 'e-sex', 'esex',
  'cp', 'jailbait', 'minor', 'underage', 'predator', 'predators', 'nonce',
  // Impersonation / reserved
  'admin', 'administrator', 'moderator', 'modteam', 'official', 'playmotus', 'staff',
  'support', 'system', 'undefined', 'null', 'owner', 'motus', 'dev', 'developer',
  // Extra slurs / hate
  'kys', 'kms', 'killyourself', 'killurself', 'schoolshooter', 'whitepower',
  'heil', 'hitler', 'nazi', 'nazis', 'kkk', '1488', '88', '14words',
  // Leet / variant spellings (common bypass attempts)
  'fuk', 'fukk', 'fuq', 'fck', 'fuc', 'phuck', 'phuk', 'sh1t', 'b1tch', 'a55',
  'azz', 'd1ck', 'dik', 'c0ck', 'kawk', 'kock', 'p0rn', 'pr0n', 's3x', 'sexx',
  'n1gga', 'n1gger', 'nigg3r', 'f4g', 'f4gg0t', 'r3tard', 'ret4rd', 'wh0re',
  'sl00t', 'th0t', 'c00mer', 'g00n', 'g00ner', 's1mp', 'h0rny', 'p3do', 'ped0',
]

const LEET_MAP = {
  '@': 'a', '4': 'a', '8': 'b', '(': 'c', '<': 'c', '3': 'e', '€': 'e',
  '6': 'g', '#': 'h', '!': 'i', '1': 'i', '|': 'i', '0': 'o', '9': 'g',
  '$': 's', '5': 's', '7': 't', '+': 't', '2': 'z', '©': 'c',
}

function normalizeToken(raw) {
  let s = raw.toLowerCase().trim()
  for (const [from, to] of Object.entries(LEET_MAP)) {
    s = s.split(from).join(to)
  }
  s = s.replace(/[^a-z0-9]/g, '')
  s = s.replace(/(.)\1+/g, '$1')
  return s
}

function addWord(set, raw) {
  const n = normalizeToken(raw)
  if (n.length >= 2 && n.length <= 24) set.add(n)
  // Also add tokens from multi-word phrases
  for (const part of raw.toLowerCase().split(/[\s/._-]+/)) {
    const p = normalizeToken(part)
    if (p.length >= 2 && p.length <= 24) set.add(p)
  }
}

async function fetchList(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const text = await res.text()
    return text.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const words = new Set()

for (const url of SOURCES) {
  const lines = await fetchList(url)
  console.log(`Fetched ${lines.length} lines from ${url}`)
  for (const line of lines) addWord(words, line)
}

for (const w of CUSTOM_WORDS) addWord(words, w)

// Keep original spellings for high-priority roots (collapse would turn "goon" → "gon").
const CRITICAL_PRESERVE = [
  'goon', 'gooner', 'gooning', 'goons', 'goontok', 'goonhub', 'goonette', 'goonbait',
  'g00n', 'g00ner',
]
for (const w of CRITICAL_PRESERVE) {
  const plain = w.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (plain.length >= 2) words.add(plain)
}

// Generate leet variants for words 4+ chars (limited substitutions)
function leetVariants(word) {
  const subs = [
    ['a', ['4', '@']],
    ['e', ['3']],
    ['i', ['1', '!']],
    ['o', ['0']],
    ['s', ['5', '$']],
    ['t', ['7']],
  ]
  let variants = new Set([word])
  for (const [char, reps] of subs) {
    if (!word.includes(char)) continue
    const next = new Set()
    for (const v of variants) {
      next.add(v)
      for (const r of reps) {
        next.add(v.replaceAll(char, r))
      }
    }
    variants = next
  }
  return [...variants].map(normalizeToken).filter((v) => v.length >= 2)
}

const baseWords = [...words].filter((w) => w.length >= 4 && w.length <= 12)
for (const w of baseWords.slice(0, 400)) {
  for (const v of leetVariants(w)) words.add(v)
}

const sorted = [...words].sort()
const outPath = resolve(process.cwd(), 'src/lib/blocked-words.json')
writeFileSync(outPath, JSON.stringify(sorted, null, 0))
console.log(`Wrote ${sorted.length} blocked words to ${outPath}`)
