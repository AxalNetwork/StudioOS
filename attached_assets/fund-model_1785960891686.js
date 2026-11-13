// Shared fund model for Axal VC Spin-Out Fund I.
// Classic script (NOT an ES module) so it loads the same way as support.js — works from
// file://, survives single-file bundling, and is readable synchronously on first paint.
// Both `Quarterly Report.dc.html` and `LP Investor Workspace.dc.html` read it, so
// positions, deployment, MOIC, follow-ons and reserve cannot drift between documents.
(function (root) {
  // `initial` is the stored first check. `invested` is ALWAYS initial + follow-on,
  // derived below, so an implausible initial cannot arise silently.
  var POSITIONS = [
    { company:'NovaCraft AI',     sector:'Workflow automation',      cohort:'C3', initial:150, held:225, status:'Outperforming' },
    { company:'MeridianIQ',       sector:'Deal intelligence',        cohort:'C3', initial:150, held:210, status:'Outperforming' },
    { company:'LoopSense',        sector:'Sensor analytics',         cohort:'C3', initial:125, held:150, status:'On plan' },
    { company:'Foundry Legal',    sector:'Contract operations',      cohort:'C3', initial:100, held:110, status:'On plan' },
    { company:'Arcline',          sector:'Financial infrastructure', cohort:'C2', initial:150, held:325, status:'Outperforming', followOn:100 },
    { company:'Kelp Bio',         sector:'Materials science',        cohort:'C2', initial:150, held:150, status:'Monitor' },
    { company:'Verity Health',    sector:'Clinical operations',      cohort:'C2', initial:150, held:195, status:'On plan' },
    { company:'Northwind Data',   sector:'Data infrastructure',      cohort:'C2', initial:200, held:240, status:'On plan' },
    { company:'Cadence Robotics', sector:'Robotics',                 cohort:'C1', initial:135, held:400, status:'Outperforming', followOn:115 },
    { company:'Solvent Climate',  sector:'Climate tech',             cohort:'C1', initial:200, held:200, status:'Monitor' },
    { company:'Halyard Security', sector:'Cybersecurity',            cohort:'C1', initial:175, held:195, status:'Early' },
  ];

  var FUND = {
    target: 20, committed: 6.8, called: 2.4, softCircled: 1.4,
    lpCount: 31, minTicketK: 50, allocThresholdK: 250, lpCommitK: 250,
    reservePolicy: 0.40,   // ceiling on commitments; follow-ons are the only draw
  };

  function r2(n) { return Math.round(n * 100) / 100; }

  // All amounts in $K unless the name ends in M.
  function fundModel() {
    var positions = POSITIONS.map(function (p) {
      var o = {}; for (var k in p) o[k] = p[k];
      o.invested = p.initial + (p.followOn || 0);
      return o;
    });
    var sum = function (f) { return positions.reduce(function (a, p) { return a + (f(p) || 0); }, 0); };
    var investedK = sum(function (p) { return p.invested; });
    var heldK = sum(function (p) { return p.held; });
    var followOnK = sum(function (p) { return p.followOn; });
    var reserveOpenM = r2(FUND.committed * FUND.reservePolicy);
    var reserveDrawM = r2(followOnK / 1000);
    return {
      ok: true, positions: positions, fund: FUND,
      investedK: investedK, heldK: heldK, followOnK: followOnK,
      followOnCount: positions.filter(function (p) { return p.followOn; }).length,
      grossMoic: heldK / investedK,
      capacityRemainingM: r2(FUND.target - FUND.committed),
      reserveOpenM: reserveOpenM, reserveDrawM: reserveDrawM,
      reserveCloseM: r2(reserveOpenM - reserveDrawM),
      byCohort: function (code, field) {
        return positions.filter(function (p) { return p.cohort === code; })
          .reduce(function (a, p) { return a + (p[field] || 0); }, 0);
      },
    };
  }

  var money = {
    m:  function (k) { return '$' + (k / 1000).toFixed(2).replace(/0$/, '') + 'M'; },
    m2: function (k) { return '$' + (k / 1000).toFixed(2) + 'M'; },
    k:  function (k) { return '$' + k + 'K'; },
    usd:function (k) { return '$' + Math.round(k * 1000).toLocaleString('en-US'); },
  };

  root.FundModel = fundModel;
  root.FundMoney = money;
})(typeof window !== 'undefined' ? window : this);
