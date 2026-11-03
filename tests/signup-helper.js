// Signs a player up the way the browser does: ask for an email code, then register with it.
// Tests run without an email provider, so the server returns the code as devOtp.
export async function signUp(request, { email, displayName, password }) {
  const sent = await request('/api/auth/otp/send', { body: { email, displayName } })
  if (sent.status !== 200) return sent
  return request('/api/users/register', { body: { email, displayName, password, otpToken: sent.data.otpToken, otp: sent.data.devOtp } })
}
