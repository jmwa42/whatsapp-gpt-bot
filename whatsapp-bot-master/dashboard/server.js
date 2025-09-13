import express from 'express';
import fs from 'fs';
import bodyParser from 'body-parser';

const app = express();
app.set('view engine', 'ejs');
app.set('views', './dashboard/views');
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('<h2>Dashboard</h2><ul><li><a href="/business">Edit Business Info</a></li></ul>');
});

app.get('/business', (req, res) => {
  const biz = JSON.parse(fs.readFileSync('./bot/business.json', 'utf8'));
  res.render('business', { biz });
});

app.post('/business', (req, res) => {
  const updated = {
    opening_hours: req.body.opening_hours,
    location: req.body.location,
    contact: req.body.contact,
    price_list: {}
  };
  req.body.services?.forEach((svc, i) => {
    if (svc) updated.price_list[svc] = req.body.prices[i] || '';
  });
  fs.writeFileSync('./bot/business.json', JSON.stringify(updated, null, 2));
  res.redirect('/business');
});

app.listen(3000, () => console.log('🌐 Dashboard running at http://localhost:3000'));


