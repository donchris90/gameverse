// Creates a second account over HTTP and has it send a friend request to the device user.
// Inputs (env): API_URL, PASSWORD, TARGET_USERNAME. Outputs: output.rival, output.rivalToken.
// The device user must already have a profile (the flow registers them first).
function call(method, path, body, token) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var options = { headers: headers };
  if (body) options.body = JSON.stringify(body);
  var res =
    method === 'GET'
      ? http.get(API_URL + path, options)
      : method === 'PUT'
        ? http.put(API_URL + path, options)
        : http.post(API_URL + path, options);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + res.body);
  }
  return res.body ? JSON.parse(res.body) : null;
}

var suffix = String(Date.now()).slice(-7);
var rivalName = 'rival' + suffix;
var session = call('POST', '/v1/auth/register', {
  email: 'maestro-rival-' + suffix + '@example.com',
  password: PASSWORD,
  dateOfBirth: '1995-01-01',
  acceptedTerms: true,
});
var token = session.accessToken;
call('PUT', '/v1/me/profile', { username: rivalName, avatarId: 'avatar-01' }, token);
var found = call('GET', '/v1/users/search?q=' + TARGET_USERNAME, null, token);
if (!found || found.length === 0) throw new Error('device user not found: ' + TARGET_USERNAME);
call('POST', '/v1/friends/requests', { userId: found[0].userId }, token);
output.rival = rivalName;
output.rivalToken = token;
