// The rival answers the device user's chat message. Inputs (env): API_URL, RIVAL_TOKEN.
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () {
    return Math.floor(Math.random() * 16).toString(16);
  });
}
var auth = { Authorization: 'Bearer ' + RIVAL_TOKEN };
var list = http.get(API_URL + '/v1/conversations', { headers: auth });
if (list.status !== 200) throw new Error('conversations -> ' + list.status + ' ' + list.body);
var first = JSON.parse(list.body).items[0];
if (!first) throw new Error('rival has no conversation yet');
var res = http.post(API_URL + '/v1/conversations/' + first.id + '/messages', {
  headers: { 'Content-Type': 'application/json', Authorization: auth.Authorization },
  body: JSON.stringify({ body: 'hello from the rival', clientMessageId: uuid() }),
});
if (res.status !== 201) throw new Error('send -> ' + res.status + ' ' + res.body);
