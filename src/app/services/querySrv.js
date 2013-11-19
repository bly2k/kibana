define([
  'angular',
  'underscore',
  'config',
  'kbn'
],
function (angular, _, config, kbn) {
  'use strict';

  var module = angular.module('kibana.services');

  module.service('querySrv', function(dashboard, ejsResource, filterSrv, $q) {

    // Create an object to hold our service state on the dashboard
    dashboard.current.services.query = dashboard.current.services.query || {};
    _.defaults(dashboard.current.services.query,{
      idQueue : [],
      list : {},
      ids : [],
    });

    this.colors = [
      "#7EB26D","#EAB839","#6ED0E0","#EF843C","#E24D42","#1F78C1","#BA43A9","#705DA0", //1
      "#508642","#CCA300","#447EBC","#C15C17","#890F02","#0A437C","#6D1F62","#584477", //2
      "#B7DBAB","#F4D598","#70DBED","#F9BA8F","#F29191","#82B5D8","#E5A8E2","#AEA2E0", //3
      "#629E51","#E5AC0E","#64B0C8","#E0752D","#BF1B00","#0A50A1","#962D82","#614D93", //4
      "#9AC48A","#F2C96D","#65C5DB","#F9934E","#EA6460","#5195CE","#D683CE","#806EB7", //5
      "#3F6833","#967302","#2F575E","#99440A","#58140C","#052B51","#511749","#3F2B5B", //6
      "#E0F9D7","#FCEACA","#CFFAFF","#F9E2D2","#FCE2DE","#BADFF4","#F9D9F9","#DEDAF7"  //7
    ];

    // For convenience
    var ejs = ejsResource(config.elasticsearch);
    var _q = dashboard.current.services.query;

    // Holds all actual queries, including all resolved abstract queries
    var resolvedQueries = [];

    // Defaults for generic query object
    var _query = {
      alias: '',
      pin: false,
      type: 'lucene',
      enable: true
    };

    // Defaults for specific query types
    var _dTypes = {
      "lucene": {
        query: "*"
      },
      "regex": {
        query: ".*"
      },
      "topN": {
        query: "*",
        field: "_type",
        size: 5,
        union: 'AND'
      }
    };

    // query type meta data that is not stored on the dashboard object
    this.queryTypes = {
      lucene: {
        require:">=0.17.0",
        icon: "icon-circle",
        resolve: function(query) {
          // Simply returns itself
          var p = $q.defer();
          p.resolve(_.extend(query,{parent:query.id}));
          return p.promise;
        }
      },
      regex: {
        require:">=0.90.3",
        icon: "icon-circle",
        resolve: function(query) {
          // Simply returns itself
          var p = $q.defer();
          p.resolve(_.extend(query,{parent:query.id}));
          return p.promise;
        }
      },
      topN : {
        require:">=0.90.3",
        icon: "icon-cog",
        resolve: function(q) {
          var suffix = '';
          if (q.union === 'AND') {
            suffix = ' AND (' + (q.query||'*') + ')';
          } else if (q.union === 'OR') {
            suffix = ' OR (' + (q.query||'*') + ')';
          }

          var request = ejs.Request().indices(dashboard.indices);
          // Terms mode
          request = request
            .facet(ejs.TermsFacet('query')
              .field(q.field)
              .size(q.size)
              .facetFilter(ejs.QueryFilter(
                ejs.FilteredQuery(
                  ejs.QueryStringQuery(q.query || '*'),
                  filterSrv.getBoolFilter(filterSrv.ids)
                  )))).size(0);

          var results = request.doSearch();
          // Like the regex and lucene queries, this returns a promise
          return results.then(function(data) {
            var _colors = kbn.colorSteps(q.color,data.facets.query.terms.length);
            var i = -1;
            return _.map(data.facets.query.terms,function(t) {
              ++i;
              return self.defaults({
                query  : q.field+':"'+kbn.addslashes(t.term)+'"'+suffix,
                alias  : t.term + (q.alias ? " ("+q.alias+")" : ""),
                type   : 'lucene',
                color  : _colors[i],
                parent : q.id
              });
            });
          });
        }
      }
    };

    // Save a reference to this
    var self = this;

    this.init = function() {
      self.list = dashboard.current.services.query.list;
      self.ids = dashboard.current.services.query.ids;

      // Check each query object, populate its defaults
      _.each(self.list,function(query) {
        query = self.defaults(query);
      });

      if (self.ids.length === 0) {
        self.set({});
      }
    };

    // This is used both for adding queries and modifying them. If an id is passed,
    // the query at that id is updated
    this.set = function(query,id) {
      if(!_.isUndefined(id)) {
        if(!_.isUndefined(self.list[id])) {
          _.extend(self.list[id],query);
          return id;
        } else {
          return false;
        }
      } else {
        // Query must have an id and color already
        query.id = _.isUndefined(query.id) ? nextId() : query.id;
        query.color = query.color || self.colorAt(query.id);
        // Then it can get defaults
        query = self.defaults(query);
        self.list[query.id] = query;
        self.ids.push(query.id);
        return query.id;
      }
    };

    this.defaults = function(query) {
      _.defaults(query,_query);
      _.defaults(query,_dTypes[query.type]);
      query.color = query.color || self.colorAt(query.id);
      return query;
    };

    this.remove = function(id) {
      if(!_.isUndefined(self.list[id])) {
        delete self.list[id];
        // This must happen on the full path also since _.without returns a copy
        self.ids = dashboard.current.services.query.ids = _.without(self.ids,id);
        _q.idQueue.unshift(id);
        _q.idQueue.sort(function(v,k){
          return v-k;
        });
        return true;
      } else {
        return false;
      }
    };

    this.getEjsObj = function(id) {
      return self.toEjsObj(self.list[id]);
    };

    // These are the only query types that can be returned by a compound query.
    this.toEjsObj = function (q) {
      switch(q.type)
      {
      case 'lucene':
        return ejs.QueryStringQuery(q.query || '*');
      case 'regex':
        return ejs.RegexpQuery('_all',q.query);
      default:
        return false;
      }
    };

    //
    this.getQueryObjs = function(ids) {
      if(_.isUndefined(ids)) {
        return resolvedQueries;
      } else {
        return _.flatten(_.map(ids,function(id) {
          return _.where(resolvedQueries,{parent:id});
        }));
      }
    };

    // BROKEN
    this.idsByMode = function(config) {
      switch(config.mode)
      {
      case 'all':
        return _.pluck(_.where(self.list,{enable:true}),'id');
      case 'pinned':
        return _.pluck(_.where(self.list,{pin:true,enable:true}),'id');
      case 'unpinned':
        return _.pluck(_.where(self.list,{pin:false,enable:true}),'id');
      case 'selected':
        return _.intersection(_.pluck(_.where(self.list,{enable:true}),'id'),config.ids);
      case 'none':
      case 'index':
        return [];
      default:
        return _.pluck(_.where(self.list,{enable:true}),'id');
      }
    };

    // This populates the internal query list and returns a promise containing it
    this.resolve = function() {
      // Find ids of all abstract queries
      // Get a list of resolvable ids, constrast with total list to get abstract ones
      return $q.all(_.map(self.ids,function(q) {
        return self.queryTypes[self.list[q].type].resolve(_.clone(self.list[q])).then(function(data){
          return data;
        });
      })).then(function(data) {
        resolvedQueries = _.flatten(data);
        _.each(resolvedQueries,function(q,i) {
          q.id = i;
        });
        return resolvedQueries;
      });
    };

    this.isMatchAllQuery = function(id) {
      var q = self.list[id];
      return self.isMatchAllQueryObj(q);
    }

    this.isMatchAllQueryObj = function(q) {
      return (q.query == "*" || q.query == "");
    }

    //returns { query, filter }
    this.getQueryFilterParts = function (filterSrv, queries, queryString, highlight, stackedQueries) {
      if (_.isUndefined(highlight)) highlight = null;
      if (_.isUndefined(stackedQueries)) stackedQueries = null;

      var facetQuery = ejs.MatchAllQuery();

      var queryIds = self.idsByMode(queries);
      var qs = self.getQueryObjs(queryIds);

      if (qs != null && qs.length == 1) 
        if (self.isMatchAllQueryObj(qs[0])) 
          qs = null;

      var hasQueries = (qs != null && qs.length > 0) || (_.isArray(stackedQueries) && stackedQueries.length > 0);
      var shouldQueries = [];
      var must = null;

      if (hasQueries) {
        if (_.isArray(highlight) && highlight.length > 0) 
          highlight = ["_all"].concat(highlight);
        else
          highlight = null;

        if (qs != null && qs.length > 0) {
          _.each(qs, function (q) {
            var qo = self.toEjsObj(q);
            if (_.isObject(qo) && highlight != null) qo = qo.fields(highlight);
            if (must == null) must = ejs.BoolQuery();
            must = must.should(qo);
          });
        }

        if (_.isArray(stackedQueries)) {
          _.each(stackedQueries, function (query) {
            if (_.isString(query)) {
              var q = ejs.QueryStringQuery(query);
              if (highlight != null) q = q.fields(highlight);
              shouldQueries.push(q);
            }
            else if (_.isObject(query)) {
              var type = !_.isUndefined(query.type) ? query.type : null;
              switch (type) {
                case "terms": 
                  {
                    var q = ejs.TermsQuery(query.field, query.terms);
                    shouldQueries.push(q);
                  }
                  break;
              }
            }
          });
        }
      }

      var facetFilter = ejs.BoolFilter();
      if (queries.mode != "index") facetFilter = filterSrv.getBoolFilter(filterSrv.ids);
      self.appendQueryStringFilter(facetFilter, queryString);

      //optimization: move query into filter
      if (highlight == null) {
        if (must != null) facetFilter = facetFilter.must(ejs.QueryFilter(must).cache(true));
        _.each(shouldQueries, function (q) {
          facetFilter = facetFilter.should(ejs.QueryFilter(q).cache(true));
        });
        facetQuery = ejs.MatchAllQuery();
      }
      else {
        if (must != null || shouldQueries.length > 0) {
          facetQuery = ejs.BoolQuery();
          if (must != null) facetQuery = facetQuery.must(must);
          _.each(shouldQueries, function (q) {
            facetQuery = facetQuery.should(q);
          });
        }
      }

      //ensure we don't have an empty must clause
      if (facetFilter.must().length <= 0)
        facetFilter = facetFilter.must(ejs.MatchAllFilter());

      var result = { query: facetQuery, filter: facetFilter };

      return result;
    };

    this.appendAQueryStringFilter = function (facetFilter, query) {
      if (_.isString(query)) {
        var qs = ejs.QueryStringQuery(query);
        facetFilter = facetFilter.must(ejs.QueryFilter(qs).cache(true));
      }
      else if (_.isObject(query)) {
        var type = !_.isUndefined(query.type) ? query.type : null;
        switch (type) {
          case "term": 
            {
              var q = ejs.TermFilter(query.field, query.terms);
              facetFilter = facetFilter.must(q);
            }
            break;
        }
      }
    }

    this.appendQueryStringFilter = function (facetFilter, queryString) {
      if (!_.isUndefined(queryString) && queryString != null && queryString != "") {
        if (_.isArray(queryString)) {
          _.each(queryString, function (q) {
            if (!_.isUndefined(q) && q != null && q != "") {
              self.appendAQueryStringFilter(facetFilter, q);
            }
          });
        }
        else if (_.isString(queryString) || _.isObject(queryString)) {
          self.appendAQueryStringFilter(facetFilter, queryString);
        }
      }
    }

    this.getFacetFilter = function (filterSrv, queries, queryString) {
      var filterParts = self.getQueryFilterParts(filterSrv, queries, queryString);
      var result = ejs.QueryFilter(ejs.FilteredQuery(filterParts.query, filterParts.filter));
      return result;
    };

    this.getFacetQuery = function (filterSrv, queries, queryString, highlight, stackedQueries) {
      var filterParts = self.getQueryFilterParts(filterSrv, queries, queryString, highlight, stackedQueries);
      var result = ejs.FilteredQuery(filterParts.query, filterParts.filter);
      return result;
    };

    this.getFacetFilterByQueryId = function (filterSrv, id, queryString) {
      var facetFilter = filterSrv.getBoolFilter(filterSrv.ids);

      self.appendQueryStringFilter(facetFilter, queryString);

      facetFilter = ejs.QueryFilter(
        ejs.FilteredQuery(
          self.getEjsObj(id),
          facetFilter
        ));

      return facetFilter;
    };

    var nextId = function() {
      if(_q.idQueue.length > 0) {
        return _q.idQueue.shift();
      } else {
        return self.ids.length;
      }
    };

    this.colorAt = function(id) {
      return self.colors[id % self.colors.length];
    };

    self.init();
  });

});