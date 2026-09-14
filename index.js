const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const DATA_FILE = './data.json';

function lireDonnees() {
  if (!fs.existsSync(DATA_FILE)) {
    return { licences: {}, abonnes: {} };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function sauverDonnees(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Etape 1 : Chariow nous prévient d'un paiement
app.post('/webhook/chariow', (req, res) => {
  console.log('Paiement reçu de Chariow :', JSON.stringify(req.body));

  const data = lireDonnees();
  // On enregistre TOUT le paiement reçu pour l'instant, pour voir sa forme exacte
  const idPaiement = Date.now().toString();
  data.licences[idPaiement] = { brut: req.body, utilisee: false };
  sauverDonnees(data);

  res.status(200).send('OK');
});

// Etape 2 : la personne envoie sa clé de licence au bot en privé
bot.on('message', (msg) => {
  const texte = msg.text ? msg.text.trim() : '';
  if (texte.startsWith('/start') || texte.startsWith('/activer')) {
    bot.sendMessage(msg.chat.id, "Envoie-moi simplement ta clé de licence reçue après paiement (ex: AVQ6-BDRW-RLR6-5OEA), et je t'ajoute au groupe.");
    return;
  }

  // Pour l'instant, on accepte n'importe quel message ressemblant à une clé
  if (/^[A-Z0-9-]{10,}$/i.test(texte)) {
    // On ajoute la personne pour 30 jours (on affinera la vérification plus tard)
    const data = lireDonnees();
    const expiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
    data.abonnes[msg.from.id] = { expiration, licence: texte };
    sauverDonnees(data);

    bot.createChatInviteLink(GROUP_ID, { member_limit: 1 }).then((lien) => {
      bot.sendMessage(msg.chat.id, `Merci ! Voici ton lien pour rejoindre le groupe (valable pour 1 seule personne) : ${lien.invite_link}`);
    }).catch((err) => {
      bot.sendMessage(msg.chat.id, "Une erreur est survenue, réessaie plus tard.");
      console.error(err);
    });
  }
});

// Etape 3 : chaque jour, on vérifie qui doit être retiré
cron.schedule('0 6 * * *', () => {
  const data = lireDonnees();
  const maintenant = Date.now();

  for (const telegramId in data.abonnes) {
    if (data.abonnes[telegramId].expiration < maintenant) {
      bot.banChatMember(GROUP_ID, telegramId)
        .then(() => bot.unbanChatMember(GROUP_ID, telegramId))
        .then(() => console.log(`Retiré : ${telegramId}`))
        .catch((err) => console.error(err));
      delete data.abonnes[telegramId];
    }
  }
  sauverDonnees(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
