import {
  GET_MANY,
  GET_MANY_REFERENCE,
  GET_LIST,
  GET_ONE,
  CREATE,
  UPDATE,
  UPDATE_MANY,
  DELETE,
  DELETE_MANY,
} from 'react-admin';
import debug from 'debug';
import diff from 'object-diff';

const dbg = debug('ra-data-feathers:rest-client');

const { paramsForServer } = require('feathers-hooks-common');

const defaultIdKey = 'id'

function getIdKey({ resource, options }) {
  return (options[resource] && options[resource].id) || options.id || defaultIdKey;
}

function deleteProp(obj, prop) {
  let res = Object.assign({}, obj);
  delete res[prop];
  return res;
}

export default (client, options = {}) => {
  const usePatch = !!options.usePatch;
  const softDelete = !!options.softDelete;
  const serverParams = function () {
    if (softDelete) {
      return paramsForServer({ $ignoreDeletedAt: true });
    }
    return null;
  };
  const mapRequest = (type, resource, params) => {
    const idKey = getIdKey({ resource, options });
    dbg('type=%o, resource=%o, params=%o, idKey=%o', type, resource, params, idKey);
    const service = client.service(resource);
    const query = {};

    switch (type) {
      case GET_MANY:
        const ids = params.ids || [];
        query[idKey] = { $in: ids };
        query.$limit = ids.length;
        return service.find({ query });
      case GET_MANY_REFERENCE:
        if (params.target && params.id) {
          query[params.target] = params.id;
        }
      case GET_LIST:
        const { page, perPage } = params.pagination || {};
        const { field, order } = params.sort || {};
        dbg('field=%o, order=%o', field, order);
        if (perPage && page) {
          query.$limit = perPage;
          query.$skip = perPage * (page - 1);
        }
        if (order) {
          query.$sort = {
            [field === defaultIdKey ? idKey : field]: order === 'DESC' ? -1 : 1,
          };
        }
        Object.assign(query, params.filter);
        dbg('query=%o', query);
        return service.find({ query });
      case GET_ONE:
        return service.get(params.id);
      case UPDATE:
        if (usePatch) {
          const data = params.previousData ? diff(params.previousData, params.data) : params.data;
          return service.patch(params.id, data, serverParams());
        } else {
          const data = (idKey !== defaultIdKey) ? deleteProp(params.data, defaultIdKey) : params.data
          return service.update(params.id, data, serverParams());
        }
      case UPDATE_MANY:
        if (usePatch) {
          const data = params.previousData ? diff(params.previousData, params.data) : params.data;
          return Promise.all(params.ids.map(id => (service.patch(id, data, serverParams()))));
        } else {
          const data = (idKey !== defaultIdKey) ? deleteProp(params.data, defaultIdKey) : params.data
          return Promise.all(params.ids.map(id => (service.update(id, data, serverParams()))));
        }
      case CREATE:
        return service.create(params.data);
      case DELETE:
        return service.remove(params.id);
      case DELETE_MANY:
        if (service.options.multi) {
          return service.remove(null, {
            query: {
              [idKey]: {
                $in: params.ids,
              },
            },
          });
        }
        return Promise.all(params.ids.map(id => (service.remove(id))));
      default:
        return Promise.reject(`Unsupported FeathersJS restClient action type ${type}`);
    }
  };

  const mapResponse = (response, type, resource, params) => {
    const idKey = getIdKey({ resource, options });
    switch (type) {
      case GET_ONE:
      case UPDATE:
      case DELETE:
        return { data: { ...response, id: response[idKey] } };
      case UPDATE_MANY:
      case DELETE_MANY:
        return { data: response.map(record => record[idKey]) };
      case CREATE:
        return { data: { ...params.data, ...response, id: response[idKey] } };
      case GET_MANY_REFERENCE: // fix GET_MANY_REFERENCE missing id
      case GET_MANY: // fix GET_MANY missing id
      case GET_LIST:
        let res;
        // support paginated and non paginated services
        if(!response.data) {
          response.total = response.length;
          res = response;
        } else {
          res = response.data;
        }
        response.data = res.map((_item) => {
          const item = _item;
          if (idKey !== defaultIdKey) {
            item.id = _item[idKey];
          }
          return _item;
        });
        return response;
      default:
        return response;
    }
  };

  return (type, resource, params) =>
    mapRequest(type, resource, params)
      .then(response => mapResponse(response, type, resource, params));
};
