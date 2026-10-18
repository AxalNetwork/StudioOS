import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {useCart} from '../src/components/products/useCart.js';
import useAiTopupCart from '../src/hooks/useAiTopupCart.js';
function makeNode(tag) {
  return {
    tagName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    nodeType: tag === '#text' ? 3 : 1,
    nodeName: tag === '#text' ? '#text' : String(tag).toUpperCase(),
    childNodes: [],
    style: {},
    parentNode: null,
    ownerDocument: null,
    textContent: '',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    hasAttribute() { return false; },
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode = this;
      const at = this.childNodes.indexOf(ref);
      if (at < 0) this.childNodes.push(child);
      else this.childNodes.splice(at, 0, child);
      return child;
    },
    removeChild(child) {
      const at = this.childNodes.indexOf(child);
      if (at >= 0) this.childNodes.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    contains() { return false; },
    get firstChild() { return this.childNodes[0] || null; },
  };
}

function installDocument() {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    HTMLIFrameElement: globalThis.HTMLIFrameElement,
  };
  globalThis.window = globalThis;
  const document = {
    nodeType: 9,
    nodeName: '#document',
    activeElement: null,
    defaultView: globalThis,
    createElement(tag) {
      const node = makeNode(tag);
      node.ownerDocument = document;
      return node;
    },
    createElementNS(_ns, tag) { return document.createElement(tag); },
    createTextNode(text) {
      const node = makeNode('#text');
      node.textContent = String(text);
      node.ownerDocument = document;
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  document.documentElement = document.createElement('html');
  document.body = document.createElement('body');
  globalThis.document = document;
  globalThis.HTMLElement = function HTMLElement() {};
  globalThis.Element = function Element() {};
  globalThis.Node = function Node() {};
  globalThis.HTMLIFrameElement = function HTMLIFrameElement() {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.getSelection = () => null;
  return () => {
    for (const [key, value] of Object.entries(previous)) globalThis[key] = value;
  };
}


test('D629 existing checkout adds one configured top-up after an asynchronous read and preserves the cart',async()=>{
 const restore=installDocument();
 const previous={localStorage:globalThis.localStorage,fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage,addEventListener:globalThis.addEventListener,removeEventListener:globalThis.removeEventListener,dispatchEvent:globalThis.dispatchEvent};
 const events=new EventTarget(),stored=new Map();
 for(const method of ['addEventListener','removeEventListener','dispatchEvent'])globalThis[method]=events[method].bind(events);
 globalThis.sessionStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 globalThis.localStorage=globalThis.sessionStorage;
 const existing={price_id:'price_existing',name:'Existing item',unit_amount:500,currency:'usd',quantity:1};
 stored.set('axal_cart_v1',JSON.stringify([existing]));
 globalThis.fetch=async()=>new Response(JSON.stringify({configured:true,state:'ready',product:{price_id:'price_owner',product_id:'prod_owner',name:'AI top-up',unit_amount:2000,currency:'usd'}}),{status:200,headers:{'Content-Type':'application/json'}});
 const root=createRoot(document.createElement('div'));let current;
 function CheckoutCart(){const cart=useCart();const state=useAiTopupCart(cart,true);current={cart,state};return null;}
 try{
  await act(async()=>{root.render(React.createElement(CheckoutCart,{key:1}));});
  assert.equal(current.state,'ready');
  assert.deepEqual(current.cart.items.map(l=>[l.price_id,l.quantity]),[['price_existing',1],['price_owner',1]]);
  assert.equal(current.cart.subtotal,2500);
  assert.deepEqual(JSON.parse(stored.get('axal_cart_v1')),current.cart.items);
  await act(async()=>{root.render(React.createElement(CheckoutCart,{key:2}));});
  assert.deepEqual(current.cart.items.map(l=>[l.price_id,l.quantity]),[['price_existing',1],['price_owner',1]]);
  await act(async()=>{current.cart.add(existing,1);current.cart.add({...existing,price_id:'price_other'},1);});
  assert.deepEqual(current.cart.items.map(l=>[l.price_id,l.quantity]),[['price_existing',2],['price_owner',1],['price_other',1]]);
 }finally{await act(async()=>root.unmount());for(const [key,value]of Object.entries(previous))globalThis[key]=value;restore();}
});

// D750 (#1841): a top-up HQ has not finished configuring is "isn't available
// yet" at checkout, never Unreadable, and adds nothing to the cart.
test('D750 checkout reads a not_ready or unset top-up as not configured and adds no line',async()=>{
 for(const answer of [{configured:true,state:'not_ready'},{configured:false}]){
  const restore=installDocument();
  const previous={localStorage:globalThis.localStorage,fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage,addEventListener:globalThis.addEventListener,removeEventListener:globalThis.removeEventListener,dispatchEvent:globalThis.dispatchEvent};
  const events=new EventTarget(),stored=new Map();
  for(const method of ['addEventListener','removeEventListener','dispatchEvent'])globalThis[method]=events[method].bind(events);
  globalThis.sessionStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
  globalThis.localStorage=globalThis.sessionStorage;
  globalThis.fetch=async()=>new Response(JSON.stringify(answer),{status:200,headers:{'Content-Type':'application/json'}});
  const root=createRoot(document.createElement('div'));let current;
  function CheckoutCart(){const cart=useCart();const state=useAiTopupCart(cart,true);current={cart,state};return null;}
  try{
   await act(async()=>{root.render(React.createElement(CheckoutCart));});
   assert.equal(current.state,'not-configured',JSON.stringify(answer));
   assert.deepEqual(current.cart.items,[]);
  }finally{await act(async()=>root.unmount());for(const [key,value]of Object.entries(previous))globalThis[key]=value;restore();}
 }
});
