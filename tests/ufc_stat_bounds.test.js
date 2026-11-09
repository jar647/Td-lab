'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {statsFrom} = require('../ufc_app.js');

test('rejects impossible percentages and negative career rates', () => {
  const stats = statsFrom({statistics:{
    strAcc:'125%', tdDef:-1, slpm:-2, sapm:3.2,
    tdAvg:1.5, subAvg:'NaN'
  }});
  assert.equal(stats.strAcc,null);
  assert.equal(stats.tdDef,null);
  assert.equal(stats.slpm,null);
  assert.equal(stats.sapm,3.2);
  assert.equal(stats.tdAvg,1.5);
  assert.equal(stats.subAvg,null);
});
test('accepts legitimate zero and fraction percentage values', () => {
  const stats = statsFrom({statistics:{
    strAcc:'48%', strDef:0.62, tdAcc:0, tdDef:'100%'
  }});
  assert.equal(stats.strAcc,48);
  assert.equal(stats.strDef,62);
  assert.equal(stats.tdAcc,0);
  assert.equal(stats.tdDef,100);
});
test('rejects infinite, nonsensical, and negative provider values', () => {
  const stats = statsFrom({statistics:{
    strAcc:Infinity, strDef:'-3%', tdAvg:'Infinity', subAvg:'-0.5'
  }});
  assert.equal(stats.strAcc,null);
  assert.equal(stats.strDef,null);
  assert.equal(stats.tdAvg,null);
  assert.equal(stats.subAvg,null);
});
