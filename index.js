const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const axios = require('axios');
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
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
const CHARIOW_API_KEY = process.env.CHARIOW_API_KEY;

bot.on('message', async (msg) => {
  const texte = msg.text ? msg.text.trim() : '';
  if (texte.startsWith('/start') || texte.startsWith('/activer')) {
    bot.sendMessage(msg.chat.id, "Envoie-moi simplement ta clé de licence reçue après paiement (ex: AVQ6-BDRW-RLR6-5OEA), et je t'ajoute au groupe.");
    return;
  }

  if (/^[A-Z0-9-]{10,}$/i.test(texte)) {
    try {
      const reponse = await axios.get(`https://api.chariow.com/v1/licenses/${texte}`, {
        headers: { Authorization: `Bearer ${CHARIOW_API_KEY}` }
      });

      const licence = reponse.data.data;

      if (licence.is_expired) {
        bot.sendMessage(msg.chat.id, "Cette clé a expiré. Contacte le vendeur pour en obtenir une nouvelle.");
        return;
      }

      const data = lireDonnees();

      if (data.licences[texte] && data.licences[texte].utilisee) {
        bot.sendMessage(msg.chat.id, "Cette clé a déjà été utilisée par quelqu'un d'autre.");
        return;
      }

      data.licences[texte] = { utilisee: true };
      const expiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      data.abonnes[msg.from.id] = { expiration, licence: texte, username: msg.from.username || msg.from.first_name || 'inconnu' };
      sauverDonnees(data);

      const lien = await bot.createChatInviteLink(GROUP_ID, { member_limit: 1 });
      bot.sendMessage(msg.chat.id, `Merci ! Voici ton lien pour rejoindre le groupe (valable pour 1 seule personne) : ${lien.invite_link}`);
    } catch (err) {
      console.error(err.response ? err.response.data : err.message);
      bot.sendMessage(msg.chat.id, "Cette clé n'a pas été reconnue par Chariow. Vérifie qu'elle est correcte.");
    }
  }
});

// Etape 3 : chaque jour, on vérifie qui doit être retiré, et on envoie des rappels
const LIEN_PAIEMENT = 'https://africaservice.mychariow.shop/prd_abi7li74';

cron.schedule('0 6 * * *', () => {
  const data = lireDonnees();
  const maintenant = Date.now();
  const troisJours = 3 * 24 * 60 * 60 * 1000;

  for (const telegramId in data.abonnes) {
    const abonne = data.abonnes[telegramId];

    if (abonne.expiration < maintenant) {
      bot.banChatMember(GROUP_ID, telegramId)
        .then(() => bot.unbanChatMember(GROUP_ID, telegramId))
        .then(() => console.log(`Retiré : ${telegramId}`))
        .catch((err) => console.error(err));
      delete data.abonnes[telegramId];
    } else if (abonne.expiration - maintenant < troisJours && !abonne.rappelEnvoye) {
      bot.sendMessage(telegramId, `Ton abonnement se termine dans moins de 3 jours ! Pour rester dans le groupe, repaie ici : ${LIEN_PAIEMENT}`)
        .catch((err) => console.error(err));
      abonne.rappelEnvoye = true;
    }
  }
  sauverDonnees(data);
});
// Bilan quotidien envoyé au propriétaire
cron.schedule('0 8 * * *', () => {
  const data = lireDonnees();
  const maintenant = Date.now();
  const abonnes = Object.entries(data.abonnes);

  if (abonnes.length === 0) {
    bot.sendMessage(ADMIN_ID, "📊 Bilan quotidien : aucun abonné actif pour le moment.");
    return;
  }

  let message = `📊 Bilan quotidien — ${abonnes.length} abonné(s) actif(s) :\n\n`;

  abonnes.forEach(([telegramId, infos]) => {
    const dateExpiration = new Date(infos.expiration).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const joursRestants = Math.ceil((infos.expiration - maintenant) / (24 * 60 * 60 * 1000));
    message += `• @${infos.username || 'inconnu'} (id: ${telegramId}) — sort le ${dateExpiration} (dans ${joursRestants} jour(s))\n`;
  });

  bot.sendMessage(ADMIN_ID, message).catch((err) => console.error(err));
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
